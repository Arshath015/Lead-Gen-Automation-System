// Deterministic evidence scoring for the research loop (researchLoop.ts).
// Pure — no network calls — so the entire scoring model is unit-testable
// independent of Tavily/Groq.
//
// Core rule this file exists to enforce: company-only evidence can NEVER
// contribute to person confidence, no matter how many independent pages
// repeat the same company facts. Only evidence that actually names the
// person is eligible to verify a person/company association.
//
// A contradicted email domain (doesn't match the stated company) is a
// negative signal, not an absolute veto: it costs a flat penalty on the
// person score, which in practice means one strong hit (e.g. a single
// LinkedIn result) usually isn't quite enough on its own, but genuine
// independent corroboration (a second source, a company team page, etc.)
// can still outweigh it and verify the association. This was previously a
// hard cap that made verification structurally impossible regardless of
// evidence found, and — worse — let the research loop stop early the moment
// company facts alone were confirmed, without ever weighing person-specific
// evidence a later round might have found. See `contradicted` below for how
// this is still surfaced for messaging without blocking verification.

import type { TaggedSearchResult } from "../llm/ILlmAdapter";
import type { EmailDomainEvidence, LeadIdentityInput } from "./researchIdentity";

export interface ScoredEvidenceResult extends TaggedSearchResult {
  domain: string;
  fingerprint: string;
  mentionsPerson: boolean;
  mentionsCompany: boolean;
}

export interface EvidenceScore {
  score: number;
  threshold: number;
  verified: boolean;
  // True only for the person dimension, when the email domain doesn't match
  // the stated company. Purely a messaging/reporting flag now — it does NOT
  // gate `verified` (that's a straight score-vs-threshold comparison, and
  // the contradiction's cost is already baked into `score` via
  // EMAIL_MISMATCH_PENALTY). Lets callers distinguish "verified cleanly"
  // from "verified despite an unresolved contradiction," and "unverified,
  // no contradiction, just not enough evidence yet" from "unverified AND
  // actively contradicted."
  contradicted: boolean;
  independentSources: number;
}

export interface ResearchConfidenceResult {
  person: EvidenceScore;
  company: EvidenceScore;
  overallConfidence: "high" | "medium" | "low";
  emailDomainEvidence: EmailDomainEvidence;
  companyNameIsCommon: boolean;
  reasons: string[];
}

const PERSON_THRESHOLD = 6;
const COMPANY_THRESHOLD = 2;
const COMMON_COMPANY_THRESHOLD = 3; // a generic company name needs one more independent source before we trust it's even the right org

const PERSON_ASSOCIATION_BASE = 3; // person-at-company hit that names BOTH the person and the company
const PERSON_IDENTITY_ONLY_BASE = 1; // person-identity hit that names the person, with no company corroboration in that same snippet
const LINKEDIN_SOURCE_BONUS = 2;
const VERIFIED_DOMAIN_SOURCE_BONUS = 2; // hit's own domain matches the lead's stored companyDomain
const CORROBORATION_BONUS_PER_EXTRA_SOURCE = 2;
const EMAIL_CONFIRMS_BONUS = 4;
// Symmetric-in-spirit with EMAIL_CONFIRMS_BONUS, not equal in magnitude: a
// confirmed domain is treated as a strong positive; a mismatched one is a
// real but not maximal negative, since manually-entered leads legitimately
// use personal/alias addresses for all sorts of ordinary reasons unrelated
// to identity fraud. Chosen so a single strong hit (association base +
// LinkedIn bonus = 5) isn't quite enough alone, but two independently
// corroborating hits comfortably are — see researchEvidence.test.ts.
const EMAIL_MISMATCH_PENALTY = -3;

const COMPANY_HIT_VALUE = 1;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Cheap, deterministic near-duplicate detector: the same press release
// mirrored across five aggregator domains will normalize to (near-)identical
// leading text even though the URLs and domains all differ. Comparing a
// fixed-length normalized prefix is enough to collapse those into one piece
// of evidence for corroboration purposes without needing a real similarity
// library — a genuinely independent article about the same topic almost
// never opens with the same 120 characters.
export function contentFingerprint(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .slice(0, 120);
}

function containsName(haystack: string, name: string): boolean {
  if (!name.trim()) return false;
  return haystack.toLowerCase().includes(name.trim().toLowerCase());
}

export function annotateEvidence(results: TaggedSearchResult[], lead: Pick<LeadIdentityInput, "fullName" | "company">): ScoredEvidenceResult[] {
  const fullName = lead.fullName?.trim() ?? "";
  const company = lead.company?.trim() ?? "";
  return results.map((r) => {
    const haystack = `${r.title} ${r.content}`;
    return {
      ...r,
      domain: extractDomain(r.url),
      fingerprint: contentFingerprint(r.content || r.title),
      mentionsPerson: containsName(haystack, fullName),
      mentionsCompany: company ? containsName(haystack, company) : false,
    };
  });
}

function scorePersonDimension(
  evidence: ScoredEvidenceResult[],
  companyDomain: string | null,
  emailDomainEvidence: EmailDomainEvidence
): EvidenceScore {
  const contradicted = emailDomainEvidence === "mismatch";

  const qualifying = new Map<string, number>(); // fingerprint -> best value seen for that fingerprint
  for (const r of evidence) {
    let value = 0;
    if (r.purpose === "person-at-company" && r.mentionsPerson && r.mentionsCompany) {
      value = PERSON_ASSOCIATION_BASE;
    } else if (r.purpose === "person-identity" && r.mentionsPerson) {
      value = PERSON_IDENTITY_ONLY_BASE;
    } else {
      continue; // company-only evidence, or a person-at-company hit that named neither/only the company: never contributes to person score
    }
    if (r.domain.includes("linkedin.com")) value += LINKEDIN_SOURCE_BONUS;
    if (companyDomain && r.domain && r.domain === extractDomain(`https://${companyDomain.replace(/^https?:\/\//, "")}`)) {
      value += VERIFIED_DOMAIN_SOURCE_BONUS;
    }
    const existing = qualifying.get(r.fingerprint) ?? 0;
    if (value > existing) qualifying.set(r.fingerprint, value);
  }

  const values = [...qualifying.values()];
  const emailAdjustment =
    emailDomainEvidence === "confirms" ? EMAIL_CONFIRMS_BONUS : emailDomainEvidence === "mismatch" ? EMAIL_MISMATCH_PENALTY : 0;
  const score =
    values.reduce((sum, v) => sum + v, 0) +
    Math.max(0, values.length - 1) * CORROBORATION_BONUS_PER_EXTRA_SOURCE +
    emailAdjustment;

  return {
    score,
    threshold: PERSON_THRESHOLD,
    verified: score >= PERSON_THRESHOLD,
    contradicted,
    independentSources: values.length,
  };
}

function scoreCompanyDimension(evidence: ScoredEvidenceResult[], companyNameIsCommon: boolean): EvidenceScore {
  const threshold = companyNameIsCommon ? COMMON_COMPANY_THRESHOLD : COMPANY_THRESHOLD;
  const qualifyingFingerprints = new Set<string>();
  for (const r of evidence) {
    if (r.purpose === "company-generic" && r.mentionsCompany) {
      qualifyingFingerprints.add(r.fingerprint);
    }
  }
  const score = qualifyingFingerprints.size * COMPANY_HIT_VALUE;
  return {
    score,
    threshold,
    verified: score >= threshold,
    contradicted: false, // no signal contradicts a company's own existence the way an email mismatch contradicts a person's association with it
    independentSources: qualifyingFingerprints.size,
  };
}

export function scoreEvidence(
  taggedResults: TaggedSearchResult[],
  lead: LeadIdentityInput,
  signals: { emailDomainEvidence: EmailDomainEvidence; companyNameIsCommon: boolean }
): { evidence: ScoredEvidenceResult[]; confidence: ResearchConfidenceResult } {
  const annotated = annotateEvidence(taggedResults, lead);

  // Scoring dedupes WITHIN each dimension separately (scorePersonDimension/
  // scoreCompanyDimension each key their own fingerprint map), not via one
  // shared global dedup pass — if the exact same page were ever returned by
  // both a person-directed and a company-directed query, a single global
  // dedup keyed only on fingerprint could let one dimension's duplicate
  // silently swallow the other dimension's only occurrence, losing
  // legitimate credit for whichever purpose didn't "win" the collision. The
  // two dimensions must never be able to interfere with each other that way.
  //
  // `deduped` below is a separate, display/storage-only global dedup (first
  // occurrence wins) — purely to avoid showing the LLM and the stored brief
  // the same syndicated content three times; it never feeds scoring.
  const person = scorePersonDimension(annotated, lead.companyDomain, signals.emailDomainEvidence);
  const company = scoreCompanyDimension(annotated, signals.companyNameIsCommon);

  const seen = new Set<string>();
  const deduped = annotated.filter((r) => {
    if (!r.fingerprint || seen.has(r.fingerprint)) return false;
    seen.add(r.fingerprint);
    return true;
  });

  const reasons: string[] = [];
  if (signals.emailDomainEvidence === "mismatch") {
    reasons.push(
      person.verified
        ? `Verified through independent evidence, though the email domain does not match "${lead.company}" — that mismatch remains unexplained.`
        : `Independent evidence was insufficient to confirm the person/company association, and the email domain not matching "${lead.company}" adds to that uncertainty.`
    );
  } else if (!person.verified) {
    reasons.push(
      person.independentSources === 0
        ? "No search result found that names this specific person in connection with the company."
        : "Some evidence names the person, but not enough independent corroboration to verify the person/company association."
    );
  }
  if (signals.companyNameIsCommon) {
    reasons.push(`"${lead.company}" is a common/generic company name; extra independent corroboration is required before trusting company evidence belongs to the right organization.`);
  }
  if (!company.verified) {
    reasons.push("Not enough independent sources to verify basic company facts.");
  }

  const overallConfidence: ResearchConfidenceResult["overallConfidence"] =
    person.verified && company.verified
      ? person.contradicted
        ? "medium" // fully verified, but an unresolved email-domain contradiction still caps it below "high"
        : "high"
      : company.verified && person.score > 0
      ? "medium"
      : "low";

  return {
    evidence: deduped,
    confidence: {
      person,
      company,
      overallConfidence,
      emailDomainEvidence: signals.emailDomainEvidence,
      companyNameIsCommon: signals.companyNameIsCommon,
      reasons,
    },
  };
}

// Deterministic post-processing applied to whatever the LLM returns — a
// guaranteed safety net, not just a prompt instruction the model might not
// follow. Two hard rules enforced here regardless of what the model wrote:
//   1. If the person/company association isn't verified, an explicit
//      warning is programmatically PREPENDED to companyOverview (so the
//      caveat is always present, not dependent on the model choosing to
//      mention it).
//   2. If the person/company association isn't verified, painPoints is
//      forced empty — pain points are framed as "this person's role," and
//      we don't get to speculate about someone's role at a company we
//      haven't confirmed they're actually at.
// Company-level companyOverview/recentNews content is left untouched even
// when the person link is unverified, since that's independently-verified
// (or explicitly flagged unverified in its own right) company information,
// not a claim about the person.
export function applyConfidenceSafeguards<T extends { companyOverview: string | null; painPoints: string[] }>(
  generated: T,
  confidence: ResearchConfidenceResult
): T {
  const personVerified = confidence.person.verified;
  const contradicted = confidence.person.contradicted;

  let companyOverview = generated.companyOverview;
  if (personVerified && contradicted) {
    // Verified, but not cleanly — say so. A resolved association shouldn't
    // silently hide the fact that something about the lead's data was
    // still off, even though independent evidence outweighed it.
    const note = `Note: this lead's person/company association was verified through independent evidence, but the email domain does not match the stated company — that mismatch remains unexplained.`;
    companyOverview = companyOverview ? `${note} ${companyOverview}` : note;
  } else if (!personVerified) {
    const warning = contradicted
      ? `Person/company association UNVERIFIED — independent evidence was insufficient to confirm it, and the email domain not matching the stated company adds to that uncertainty. The information below is about the company; it should not be assumed to apply to this specific person.`
      : `Person/company association could not be independently confirmed with available evidence. The information below is about the company; treat any person-specific claim as unresolved.`;
    companyOverview = companyOverview ? `${warning} ${companyOverview}` : warning;
  }

  return {
    ...generated,
    companyOverview,
    // Unchanged rule: painPoints are framed as "this person's role," so they
    // stay empty whenever the person link isn't verified — contradicted or
    // not. Being verified-despite-contradicted is enough to keep them.
    painPoints: personVerified ? generated.painPoints : [],
  };
}
