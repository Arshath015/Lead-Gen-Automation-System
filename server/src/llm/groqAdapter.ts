import Groq, { APIError } from "groq-sdk";
import { env } from "../config/env";
import type { GeneratedEmailDraft, GeneratedResearchBrief, ILlmAdapter, ResearchBriefForDraft } from "./ILlmAdapter";
import type { ScoredEvidenceResult, ResearchConfidenceResult } from "../services/researchEvidence";
import { budgetEvidenceForPrompt } from "../services/evidenceBudget";

const client = new Groq({ apiKey: env.groqApiKey });

// When a real signature is saved, it already carries its own closing (e.g.
// "Regards, Arshath Farwyz"), so the model must end right after the message
// itself — any closing line it added would stack a second one in front of
// the real signature. Without a saved signature, the previous behavior is
// kept unchanged: the model writes a generic closing line and the system's
// "[Your Name]" fallback is appended after it.
function closingInstruction(hasSavedSignature: boolean): string {
  return hasSavedSignature
    ? 'End the email right after the final message or call-to-action. Do not add any closing or sign-off line (e.g. "Best,", "Regards,", "Thanks,", "Sincerely," or similar), a name, a placeholder like [Your Name], or any signature block — the sender\'s real signature already includes its own closing and is appended separately by the system.'
    : 'End the email right after the closing line (e.g. "Best," or "Regards,") — do not add a name, placeholder like [Your Name], or any signature block; a signature is appended separately by the system.';
}

function leadDescription(lead: Parameters<ILlmAdapter["generateResearchBrief"]>[0]): string {
  return [
    `Name: ${lead.fullName}`,
    lead.title ? `Title: ${lead.title}` : null,
    lead.company ? `Company: ${lead.company}` : null,
    lead.companyDomain ? `Company domain: ${lead.companyDomain}` : null,
    lead.location ? `Location: ${lead.location}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// Under Groq's strict json_schema mode, gpt-oss-20b sometimes generates a
// JSON object that is otherwise complete and correct but omits a top-level
// array property entirely (e.g. no "sources" key at all) when it judges that
// section to be empty, rather than emitting `[]`. Groq's own validator then
// rejects the whole response with a 400 `json_validate_failed` before it
// reaches us — even though the rest of the content (the real research) is
// fine. Recover by reading the actual generated JSON out of the error's
// `failed_generation` field and backfilling only the missing array-typed
// keys with `[]`. This uses the model's real output verbatim; it never
// invents content for a field that has values.
function recoverFromValidationError(err: unknown, schema: Record<string, unknown>): Record<string, unknown> | null {
  if (!(err instanceof APIError)) return null;
  const body = err.error as { code?: string; failed_generation?: string } | undefined;
  if (body?.code !== "json_validate_failed" || !body.failed_generation) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body.failed_generation) as Record<string, unknown>;
  } catch {
    return null;
  }

  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [key, def] of Object.entries(properties)) {
    if (def.type === "array" && !(key in data)) {
      data[key] = [];
    }
  }

  const required = (schema.required ?? []) as string[];
  const stillMissing = required.filter((key) => !(key in data));
  if (stillMissing.length > 0) return null;

  return data;
}

async function createJsonCompletion(
  params: Omit<Parameters<typeof client.chat.completions.create>[0], "response_format">,
  schemaName: string,
  schema: Record<string, unknown>,
  attempts = 2
): Promise<{ data: Record<string, unknown>; response: Groq.Chat.ChatCompletion | null }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Groq.Chat.ChatCompletion;
    try {
      response = (await client.chat.completions.create({
        ...params,
        response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } },
      })) as Groq.Chat.ChatCompletion;
    } catch (err) {
      const recovered = recoverFromValidationError(err, schema);
      if (recovered) return { data: recovered, response: null };
      lastErr = err;
      continue;
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      lastErr = new Error("Model returned an empty response");
      continue;
    }
    try {
      return { data: JSON.parse(content) as Record<string, unknown>, response };
    } catch {
      lastErr = new Error("Model returned invalid JSON");
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Model did not return valid JSON");
}

const RESEARCH_BRIEF_SCHEMA = {
  type: "object",
  properties: {
    companyOverview: { type: "string", description: "2-4 sentence summary of what the company does." },
    recentNews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publishedAt: { type: ["string", "null"] },
          summary: { type: "string" },
        },
        required: ["title", "url", "publishedAt", "summary"],
        additionalProperties: false,
      },
    },
    painPoints: {
      type: "array",
      items: { type: "string" },
      description: "Likely pain points or talking points relevant to this person's role, for personalizing outreach.",
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, url: { type: "string" } },
        required: ["title", "url"],
        additionalProperties: false,
      },
    },
  },
  required: ["companyOverview", "recentNews", "painPoints", "sources"],
  additionalProperties: false,
};

// Defense in depth: even with an explicit prompt instruction, the model can
// still slip in an em dash. Replace it with punctuation that reads naturally
// rather than just deleting it (which can smash two clauses together): a
// numeric range ("2020—2021") becomes a hyphen, everything else — spaced or
// not — becomes a comma break, since that's how em dashes are used in prose.
function stripEmDashes(text: string): string {
  return text
    .replace(/(\d)\s*—\s*(\d)/g, "$1-$2")
    .replace(/\s*—\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,(\s*[.!?])/g, "$1");
}

const EMAIL_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string", description: "Plain text email body, no HTML." },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

const PURPOSE_LABELS: Record<ScoredEvidenceResult["purpose"], string> = {
  "person-identity": "PERSON-IDENTITY EVIDENCE (about this specific person — e.g. their LinkedIn/professional profile)",
  "person-at-company": "PERSON-AT-COMPANY EVIDENCE (mentions this specific person together with this specific company)",
  "company-generic": "COMPANY-GENERAL EVIDENCE (about the company in general — NOT necessarily about this specific person)",
};

// Groups scored results into clearly-labeled sections rather than one flat
// list, so the prompt below can instruct the model to only attribute a fact
// to the person when it comes from a person-labeled section — company-only
// evidence must never be read as a personal fact about them. Each item also
// states whether researchEvidence.ts's own deterministic check found the
// person's/company's name actually present in it, since a "person-at-company"
// -purpose result that doesn't actually mention the person is weak
// corroboration at best, not proof.
function formatScoredResults(results: ScoredEvidenceResult[]): string {
  if (results.length === 0) return "(no search results found)";
  const byPurpose = new Map<ScoredEvidenceResult["purpose"], ScoredEvidenceResult[]>();
  for (const r of results) {
    const list = byPurpose.get(r.purpose) ?? [];
    list.push(r);
    byPurpose.set(r.purpose, list);
  }
  const order: ScoredEvidenceResult["purpose"][] = ["person-identity", "person-at-company", "company-generic"];
  return order
    .filter((p) => byPurpose.has(p))
    .map((p) => {
      const items = byPurpose.get(p) as ScoredEvidenceResult[];
      const body = items
        .map(
          (r, i) =>
            `[${i + 1}] (${r.strength} evidence; mentions person: ${r.mentionsPerson}; mentions company: ${r.mentionsCompany}) ${r.title}\nURL: ${r.url}\nPublished: ${r.publishedDate ?? "unknown"}\n${r.content}`
        )
        .join("\n\n");
      return `=== ${PURPOSE_LABELS[p]} ===\n${body}`;
    })
    .join("\n\n");
}

// Surfaces researchEvidence.ts's deterministic scoring as plain instructions
// the model must follow, rather than leaving uncertainty handling to its own
// judgment — the same scoring that decided whether to keep searching is what
// gates how confidently the model is allowed to write about the person's
// association with the company. Note: this is belt-and-suspenders context
// for the model, not the actual safety mechanism — applyConfidenceSafeguards
// (researchEvidence.ts) deterministically enforces the same rules on the
// model's output afterward regardless of whether it followed this correctly.
function confidenceContext(confidence: ResearchConfidenceResult): string {
  const lines = [
    `Person/company association: ${
      confidence.person.verified
        ? confidence.person.contradicted
          ? "VERIFIED (though the email domain does not match the company — flagged, not disqualifying)"
          : "VERIFIED"
        : confidence.person.contradicted
        ? "UNVERIFIED — email domain CONTRADICTS the stated company, and independent evidence wasn't enough to outweigh it"
        : "UNVERIFIED (insufficient evidence)"
    }`,
    `Company facts: ${confidence.company.verified ? "VERIFIED (independently corroborated)" : "not independently verified"}`,
    confidence.emailDomainEvidence === "mismatch"
      ? "WARNING: the lead's email domain does NOT appear to match the stated company."
      : null,
    confidence.emailDomainEvidence === "confirms"
      ? "The lead's email domain matches the stated company (corroborating evidence)."
      : null,
    confidence.companyNameIsCommon
      ? "WARNING: the company name is common/generic — company-general evidence may belong to an unrelated organization of the same name."
      : null,
    ...confidence.reasons.map((r) => `- ${r}`),
  ].filter((line): line is string => !!line);
  return lines.join("\n");
}

// Builds the exact prompt string sent to Groq for research-brief generation.
// Exported and pure (no network call) specifically so the evidence-budget
// enforcement below is directly testable against real prompt text, not just
// against the intermediate evidence array — `includeRawContent: true` (see
// tavilyAdapter.ts) fetches full page text so scoring can see a name mention
// a summarized extract might cut off, but that same full text concatenated
// across several results is what pushed a single request to ~51,000 tokens
// against Groq's 8,000-token-per-minute limit. Scoring itself (researchLoop.ts
// / researchEvidence.ts) still runs on the untruncated content — budgeting
// happens only here, on the copy of the evidence that actually reaches the
// prompt, via budgetEvidenceForPrompt (evidenceBudget.ts).
export function buildResearchBriefPrompt(
  lead: Parameters<ILlmAdapter["generateResearchBrief"]>[0],
  searchResults: ScoredEvidenceResult[],
  confidence: ResearchConfidenceResult
): string {
  const budgeted = budgetEvidenceForPrompt(searchResults);
  const searchContext = formatScoredResults(budgeted);

  return `You are researching a sales lead ahead of a personalized cold outreach email. Use ONLY the search results below, which are grouped by what they actually provide evidence for. Do not invent facts.\n\nCRITICAL: results labeled COMPANY-GENERAL describe the organization in general and are NOT necessarily about this specific person — never state a company-general fact as if it were something this person personally said, did, or is responsible for. Only PERSON-IDENTITY and PERSON-AT-COMPANY evidence that actually mentions the person (see "mentions person: true/false" on each result) may be used to make a claim specifically about ${lead.fullName}.\n\n${confidenceContext(confidence)}\n\nIf the person/company association above is UNVERIFIED or CONTRADICTED, say so explicitly and plainly in companyOverview (e.g. "Note: this lead's company/person association could not be fully confirmed because ...") instead of presenting an uncertain guess as settled fact — this will also be enforced deterministically after you respond, so treat it as a hard requirement, not a suggestion. If there isn't enough reliable evidence to say anything meaningful about the person, it is correct for painPoints to stay an empty array rather than be filled with speculation about their role.\n\ncompanyOverview must combine THREE things, in this order, using every relevant piece of evidence available rather than just the first result you see — a brief that only restates the person's title is incomplete:\n1. Company research, drawn from COMPANY-GENERAL evidence: what the company does, its products/services, industry, scale, locations, and any business developments or initiatives (funding, launches, expansion, hiring) or potential challenges the evidence actually supports. Draw on multiple COMPANY-GENERAL sources when more than one is available — do not rely on the person's LinkedIn profile as your only source of company information.\n2. Individual research, drawn from PERSON-IDENTITY/PERSON-AT-COMPANY evidence that mentions the person: their role, responsibilities, professional background, and any initiatives of theirs the evidence supports.\n3. Combined sales context: brief this person's relevance to our outreach by connecting the company research to the individual research (e.g. their role plus a company initiative or challenge the evidence points to).\nExplicitly distinguish, in the writing itself, evidence-verified facts ("the company's site states...", "according to...") from your own reasonable inferences ("this suggests...", "likely...") — never present an inference as a verified fact. If COMPANY-GENERAL evidence is present, use it; do not write a companyOverview that only covers the person just because person evidence happens to be more detailed.\n\npainPoints must be evidence-based, combining both dimensions: likely pain points or opportunities that follow from the company's situation (per COMPANY-GENERAL evidence) AND this person's role in it (per PERSON evidence), explaining why this lead is relevant to outreach. Never fabricate a pain point that isn't reasonably supported by the evidence above.\n\nsources must reflect the range of evidence actually used — if COMPANY-GENERAL sources were used for the company research, include them alongside any person-specific source; do not report only the person's LinkedIn profile when company sources were available.\n\nYour response must be a single JSON object with exactly these four keys, always present: "companyOverview" (string), "recentNews" (array), "painPoints" (array), "sources" (array). If a section has nothing to report, include it as an empty array ([]) — never omit the key.\n\nLead:\n${leadDescription(lead)}\n\nSearch results:\n${searchContext}`;
}

export const groqAdapter: ILlmAdapter = {
  name: "groq",

  async generateResearchBrief(lead, searchResults, confidence): Promise<GeneratedResearchBrief> {
    const { data, response } = await createJsonCompletion(
      {
        model: env.groqModel,
        max_completion_tokens: 4000,
        temperature: 0.2,
        reasoning_effort: "low",
        messages: [
          {
            role: "user",
            content: buildResearchBriefPrompt(lead, searchResults, confidence),
          },
        ],
      },
      "research_brief",
      RESEARCH_BRIEF_SCHEMA
    );

    return {
      companyOverview: (data.companyOverview as string) ?? null,
      recentNews: (data.recentNews as GeneratedResearchBrief["recentNews"]) ?? [],
      painPoints: (data.painPoints as string[]) ?? [],
      sources: (data.sources as GeneratedResearchBrief["sources"]) ?? [],
      model: env.groqModel,
      raw: response,
    };
  },

  async generateEmailDraft(lead, brief: ResearchBriefForDraft, hasSavedSignature): Promise<GeneratedEmailDraft> {
    const briefContext = [
      brief.companyOverview ? `Company overview: ${brief.companyOverview}` : null,
      brief.painPoints.length ? `Likely pain points:\n- ${brief.painPoints.join("\n- ")}` : null,
      brief.recentNews.length
        ? `Recent news:\n${brief.recentNews.map((n) => `- ${n.title}: ${n.summary}`).join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const { data, response } = await createJsonCompletion(
      {
        model: env.groqModel,
        max_completion_tokens: 2000,
        temperature: 0.2,
        reasoning_effort: "low",
        messages: [
          {
            role: "user",
            content: `Write a short, personalized cold outreach email to this lead. Be specific and reference the research below where relevant, but keep it concise (under 150 words), plain text, and not salesy or generic. Do not use em dashes (—) anywhere in the subject or body; use commas, periods, or parentheses instead. ${closingInstruction(hasSavedSignature)}\n\nLead:\n${leadDescription(lead)}\n\nResearch:\n${briefContext || "(no research available)"}`,
          },
        ],
      },
      "email_draft",
      EMAIL_DRAFT_SCHEMA
    );

    return {
      subject: stripEmDashes((data.subject as string) ?? ""),
      body: stripEmDashes((data.body as string) ?? ""),
      model: env.groqModel,
      raw: response,
    };
  },

  async generateFollowUpEmail(lead, brief, previousSubject, sequenceNumber, hasSavedSignature): Promise<GeneratedEmailDraft> {
    const briefContext = [
      brief.companyOverview ? `Company overview: ${brief.companyOverview}` : null,
      brief.painPoints.length ? `Likely pain points:\n- ${brief.painPoints.join("\n- ")}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const { data, response } = await createJsonCompletion(
      {
        model: env.groqModel,
        max_completion_tokens: 2000,
        temperature: 0.2,
        reasoning_effort: "low",
        messages: [
          {
            role: "user",
            content: `Write a brief, polite follow-up email (this is follow-up #${sequenceNumber}) to a lead who has not replied to a previous cold outreach email. Do not repeat the original email; just a short, friendly nudge that keeps it light and doesn't pressure them. Reference the original subject naturally if useful. Keep it under 80 words, plain text, no em dashes (—); use commas, periods, or parentheses instead. ${closingInstruction(hasSavedSignature)}\n\nLead:\n${leadDescription(lead)}\n\nOriginal email subject: ${previousSubject}\n\nResearch context:\n${briefContext || "(none)"}`,
          },
        ],
      },
      "email_draft",
      EMAIL_DRAFT_SCHEMA
    );

    return {
      subject: stripEmDashes((data.subject as string) ?? ""),
      body: stripEmDashes((data.body as string) ?? ""),
      model: env.groqModel,
      raw: response,
    };
  },
};
