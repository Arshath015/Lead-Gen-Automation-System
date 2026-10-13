import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResearchBriefPrompt } from "./groqAdapter";
import { MAX_TOTAL_EVIDENCE_CHARS } from "../services/evidenceBudget";
import type { ScoredEvidenceResult, ResearchConfidenceResult, EvidenceScore } from "../services/researchEvidence";
import type { Lead } from "../types/lead";

// Only imports the pure prompt-builder — never calls the real Groq client,
// so this suite makes no network requests. (Importing groqAdapter.ts does
// instantiate a Groq SDK client object at module load, same as every other
// test in this repo that transitively imports it — that's a local object
// construction, not a network call.)

function fakeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    source: "manual",
    sourceId: "src-1",
    dedupKey: "dedup-1",
    email: null,
    fullName: "Jane Doe",
    title: null,
    company: "Stampsize",
    companyDomain: null,
    linkedinUrl: null,
    phone: null,
    location: null,
    status: "new",
    icpProfileId: null,
    searchRunId: null,
    raw: null,
    engagementStatus: "active",
    automationEnabled: true,
    roleCategory: null,
    industry: null,
    sourceFile: null,
    sourceWorksheet: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function evidenceScore(overrides: Partial<EvidenceScore> = {}): EvidenceScore {
  return { score: 0, threshold: 6, verified: false, contradicted: false, independentSources: 0, ...overrides };
}

function fakeConfidence(overrides: Partial<ResearchConfidenceResult> = {}): ResearchConfidenceResult {
  return {
    person: evidenceScore(),
    company: evidenceScore({ threshold: 2 }),
    overallConfidence: "low",
    emailDomainEvidence: "none",
    companyNameIsCommon: false,
    reasons: [],
    ...overrides,
  };
}

function evidence(overrides: Partial<ScoredEvidenceResult>): ScoredEvidenceResult {
  return {
    title: "Title",
    url: "https://example.com/1",
    content: "content",
    publishedDate: null,
    purpose: "company-generic",
    strength: "medium",
    domain: "example.com",
    fingerprint: "fp",
    mentionsPerson: false,
    mentionsCompany: true,
    ...overrides,
  };
}

test("buildResearchBriefPrompt: oversized raw_content across many results does not balloon the prompt — this is the exact failure mode that reached ~51,000 tokens", () => {
  // Simulates the real trigger: includeRawContent: true returning a full
  // page (tens of thousands of characters) for several results at once.
  const oversizedEvidence = Array.from({ length: 15 }, (_, i) =>
    evidence({
      content: `Full raw page text. `.repeat(2000), // ~40,000 characters per item
      url: `https://example.com/${i}`,
      fingerprint: `fp-${i}`,
    })
  );

  const prompt = buildResearchBriefPrompt(fakeLead(), oversizedEvidence, fakeConfidence());

  // Unbudgeted, this would be 15 * ~40,000 = ~600,000 characters. The fix
  // must bring the total prompt down to a small, bounded size regardless of
  // how oversized the raw content was.
  assert.ok(prompt.length < 20000, `prompt was ${prompt.length} chars, expected well under 20,000`);
});

test("buildResearchBriefPrompt: the evidence section's contribution to prompt length stays within the configured total character budget", () => {
  const baseline = buildResearchBriefPrompt(fakeLead(), [], fakeConfidence());

  const oversizedEvidence = Array.from({ length: 10 }, (_, i) =>
    evidence({ content: "x".repeat(15000), url: `https://example.com/${i}`, fingerprint: `fp-${i}` })
  );
  const withEvidence = buildResearchBriefPrompt(fakeLead(), oversizedEvidence, fakeConfidence());

  const evidenceContribution = withEvidence.length - baseline.length;
  // Some formatting overhead (section headers, "mentions person:" labels,
  // URLs) is expected on top of raw content chars — allow generous headroom
  // for that without allowing the actual content budget to be exceeded.
  assert.ok(
    evidenceContribution <= MAX_TOTAL_EVIDENCE_CHARS + 3000,
    `evidence contributed ${evidenceContribution} chars, expected at most ${MAX_TOTAL_EVIDENCE_CHARS + 3000}`
  );
});

test("buildResearchBriefPrompt: a normal, already-small evidence set is passed through unaffected", () => {
  const smallEvidence = [
    evidence({ purpose: "person-at-company", mentionsPerson: true, mentionsCompany: true, content: "Jane Doe is a VP at Stampsize." }),
    evidence({ content: "Stampsize raised a funding round this year." }),
  ];
  const prompt = buildResearchBriefPrompt(fakeLead(), smallEvidence, fakeConfidence());
  assert.ok(prompt.includes("Jane Doe is a VP at Stampsize."));
  assert.ok(prompt.includes("Stampsize raised a funding round this year."));
});

test("buildResearchBriefPrompt: with no evidence at all, still produces a valid, well-formed prompt", () => {
  const prompt = buildResearchBriefPrompt(fakeLead(), [], fakeConfidence());
  assert.ok(prompt.includes("no search results found"));
  assert.ok(prompt.includes("Jane Doe"));
});

// --- Regression: the brief must combine company research, individual
// research, and sales context — not collapse into "about the person only" ---

test("buildResearchBriefPrompt: instructs the model to combine company research, individual research, and sales context, not just the person's role", () => {
  const prompt = buildResearchBriefPrompt(fakeLead(), [], fakeConfidence());
  const lower = prompt.toLowerCase();
  assert.ok(lower.includes("products/services") || lower.includes("products and services"));
  assert.ok(lower.includes("scale"));
  assert.ok(lower.includes("locations"));
  assert.ok(lower.includes("professional background") || lower.includes("responsibilities"));
  assert.ok(lower.includes("combined sales context") || lower.includes("combined sales") || (lower.includes("sales context")));
  // Must not rely on the person's LinkedIn profile as the only company source.
  assert.ok(lower.includes("do not rely on the person's linkedin profile as your only source"));
});

test("buildResearchBriefPrompt: when both company-generic and person evidence are present, both sections reach the prompt (neither is dropped)", () => {
  const mixedEvidence: ScoredEvidenceResult[] = [
    evidence({
      purpose: "person-at-company",
      mentionsPerson: true,
      mentionsCompany: true,
      content: "Jane Doe leads platform engineering at Stampsize.",
      url: "https://stampsize.com/team",
      fingerprint: "person-fp",
    }),
    evidence({
      purpose: "company-generic",
      content: "Stampsize builds outreach automation tools and recently raised a funding round.",
      url: "https://stampsize.com/about",
      fingerprint: "company-fp-1",
    }),
    evidence({
      purpose: "company-generic",
      content: "Stampsize expanded into a new region this quarter.",
      url: "https://stampsize.com/news",
      fingerprint: "company-fp-2",
    }),
  ];

  const prompt = buildResearchBriefPrompt(fakeLead(), mixedEvidence, fakeConfidence());

  assert.ok(prompt.includes("PERSON-AT-COMPANY EVIDENCE"));
  assert.ok(prompt.includes("COMPANY-GENERAL EVIDENCE"));
  assert.ok(prompt.includes("Jane Doe leads platform engineering at Stampsize."));
  assert.ok(prompt.includes("Stampsize builds outreach automation tools"));
});

test("buildResearchBriefPrompt: instructs sources to include company sources, not only the person's profile", () => {
  const prompt = buildResearchBriefPrompt(fakeLead(), [], fakeConfidence());
  assert.ok(prompt.toLowerCase().includes("do not report only the person's linkedin profile"));
});
