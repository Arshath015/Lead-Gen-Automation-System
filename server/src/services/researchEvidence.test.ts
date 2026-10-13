import { test } from "node:test";
import assert from "node:assert/strict";
import { contentFingerprint, annotateEvidence, scoreEvidence, applyConfidenceSafeguards, type ResearchConfidenceResult, type EvidenceScore } from "./researchEvidence";
import type { TaggedSearchResult } from "../llm/ILlmAdapter";
import type { LeadIdentityInput } from "./researchIdentity";

function lead(overrides: Partial<LeadIdentityInput>): LeadIdentityInput {
  return {
    fullName: "Jane Doe",
    title: null,
    company: "Stampsize",
    companyDomain: null,
    email: null,
    linkedinUrl: null,
    location: null,
    ...overrides,
  };
}

function result(overrides: Partial<TaggedSearchResult>): TaggedSearchResult {
  return {
    title: "Some title",
    url: "https://example.com/a",
    content: "Some content",
    publishedDate: null,
    purpose: "company-generic",
    strength: "medium",
    ...overrides,
  };
}

// --- contentFingerprint ---------------------------------------------------

test("contentFingerprint: identical content (even reformatted with different whitespace/case) produces the same fingerprint", () => {
  const a = contentFingerprint("Aiera Raises $25M in Series B Funding Round, led by Wall Street banks.");
  const b = contentFingerprint("AIERA RAISES $25M IN SERIES B FUNDING ROUND,   led by Wall   Street banks.");
  assert.equal(a, b);
});

test("contentFingerprint: genuinely different content produces different fingerprints", () => {
  const a = contentFingerprint("Aiera Raises $25M in Series B Funding Round led by Wall Street banks");
  const b = contentFingerprint("Aiera Appoints Eric Lebovich as Head of Product Management this week");
  assert.notEqual(a, b);
});

// --- annotateEvidence ------------------------------------------------------

test("annotateEvidence: detects exact person/company name mentions case-insensitively", () => {
  const [annotated] = annotateEvidence(
    [result({ title: "JANE DOE joins Stampsize as VP", content: "..." })],
    lead({})
  );
  assert.equal(annotated.mentionsPerson, true);
  assert.equal(annotated.mentionsCompany, true);
});

test("annotateEvidence: does not claim a mention that isn't actually present", () => {
  const [annotated] = annotateEvidence([result({ title: "Unrelated news", content: "Nothing about anyone here." })], lead({}));
  assert.equal(annotated.mentionsPerson, false);
  assert.equal(annotated.mentionsCompany, false);
});

// --- scoreEvidence: core safety rule ---------------------------------------

test("core rule: company-only evidence NEVER contributes to person score, even if it happens to mention the person's name", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "company-generic", content: "Stampsize and its team, including Jane Doe, announced record growth this year.", url: "https://a.com/1" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.person.score, 0);
  assert.equal(confidence.person.verified, false);
});

test("a person-at-company result that names the person but NOT the company contributes nothing (avoids conflating a same-named stranger)", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe spoke at a conference about unrelated topics.", url: "https://a.com/1" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.person.score, 0);
});

// --- scoreEvidence: person scoring ------------------------------------------

test("a single person-at-company hit naming both person and company contributes but stays below threshold alone", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe is a VP at Stampsize.", url: "https://a.com/1" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.person.score, 3); // base only
  assert.equal(confidence.person.verified, false);
});

test("a LinkedIn-domain hit naming the person gets a source-quality bonus", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-identity", content: "Jane Doe - Stampsize - LinkedIn profile", url: "https://www.linkedin.com/in/janedoe" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.person.score, 1 + 2); // identity-only base + linkedin bonus
});

test("a hit on the lead's own verified company domain gets a source-quality bonus", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe is a VP at Stampsize.", url: "https://stampsize.com/team/jane" }),
  ];
  const { confidence } = scoreEvidence(results, lead({ companyDomain: "stampsize.com" }), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.person.score, 3 + 2); // base + verified-domain bonus
});

test("a confirmed email domain adds a flat bonus to person score", () => {
  const results: TaggedSearchResult[] = [];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "confirms", companyNameIsCommon: false });
  assert.equal(confidence.person.score, 4);
  assert.equal(confidence.person.verified, false); // 4 < threshold 6, still unverified on its own
});

test("independent corroboration (a second, distinct-fingerprint qualifying source) adds a flat bonus and can cross the threshold", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe is a VP at Stampsize according to the company newsletter.", url: "https://a.com/1" }),
    result({ purpose: "person-at-company", content: "In an interview, Jane Doe described her role leading engineering at Stampsize.", url: "https://b.com/2" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  // 3 (first) + 3 (second, distinct fingerprint) + 2 (corroboration bonus) = 8
  assert.equal(confidence.person.score, 8);
  assert.equal(confidence.person.verified, true);
});

test("repeated syndicated copies of the same source (same content, different domains) do NOT count as independent corroboration", () => {
  const syndicated = "Stampsize Raises $25M in Series B Funding Round led by Wall Street banks and other investors in this space.";
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: `Jane Doe, the founder, said: ${syndicated}`, url: "https://siteA.com/1" }),
    result({ purpose: "person-at-company", content: `Jane Doe, the founder, said: ${syndicated}`, url: "https://siteB.com/1" }),
    result({ purpose: "person-at-company", content: `Jane Doe, the founder, said: ${syndicated}`, url: "https://siteC.com/1" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  // All three share a fingerprint -> exactly one independent source, no corroboration bonus.
  assert.equal(confidence.person.independentSources, 1);
  assert.equal(confidence.person.score, 3);
});

test("mismatch + one strong LinkedIn hit alone is NOT verified — a single hit isn't enough to outweigh a contradicted domain", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe is a VP at Stampsize.", url: "https://www.linkedin.com/in/janedoe" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "mismatch", companyNameIsCommon: false });
  // base(3) + linkedin bonus(2) - mismatch penalty(3) = 2, well short of threshold 6.
  assert.equal(confidence.person.score, 2);
  assert.equal(confidence.person.contradicted, true);
  assert.equal(confidence.person.verified, false);
});

test("mismatch + independent corroborating evidence CAN become verified — the contradiction is a penalty, not a block", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe is a VP at Stampsize.", url: "https://www.linkedin.com/in/janedoe" }),
    result({ purpose: "person-at-company", content: "Our team page lists Jane Doe as a VP at Stampsize.", url: "https://stampsize.com/team" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "mismatch", companyNameIsCommon: false });
  // (3+2 linkedin) + 3 (second, distinct fingerprint) + 2 (corroboration) - 3 (mismatch) = 7 >= threshold 6.
  assert.equal(confidence.person.score, 7);
  assert.equal(confidence.person.contradicted, true);
  assert.equal(confidence.person.verified, true); // verified DESPITE the contradiction
  assert.ok(confidence.reasons.some((r) => r.toLowerCase().includes("verified through independent evidence")));
});

// --- scoreEvidence: company scoring -----------------------------------------

test("company score counts independent (fingerprint-deduped) company-mentioning sources", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "company-generic", content: "Stampsize raised funding this year.", url: "https://a.com/1" }),
    result({ purpose: "company-generic", content: "Stampsize launched a new product this quarter.", url: "https://b.com/2" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.company.score, 2);
  assert.equal(confidence.company.verified, true); // default threshold 2
});

test("a common/generic company name requires one more independent source to be verified", () => {
  const twoSources: TaggedSearchResult[] = [
    result({ purpose: "company-generic", content: "Apex raised funding this year.", url: "https://a.com/1" }),
    result({ purpose: "company-generic", content: "Apex launched a new product this quarter.", url: "https://b.com/2" }),
  ];
  const commonLead = lead({ company: "Apex" });
  const notVerified = scoreEvidence(twoSources, commonLead, { emailDomainEvidence: "none", companyNameIsCommon: true });
  assert.equal(notVerified.confidence.company.verified, false); // 2 sources < raised threshold 3

  const threeSources = [
    ...twoSources,
    result({ purpose: "company-generic", content: "Apex expands into a new market this month.", url: "https://c.com/3" }),
  ];
  const verified = scoreEvidence(threeSources, commonLead, { emailDomainEvidence: "none", companyNameIsCommon: true });
  assert.equal(verified.confidence.company.verified, true);
});

// --- overallConfidence mapping -----------------------------------------------

test("overallConfidence: high when both person and company are verified", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe is a VP at Stampsize.", url: "https://a.com/1" }),
    result({ purpose: "person-at-company", content: "Jane Doe leads engineering at Stampsize per this bio.", url: "https://b.com/2" }),
    result({ purpose: "company-generic", content: "Stampsize raised funding.", url: "https://c.com/3" }),
    result({ purpose: "company-generic", content: "Stampsize launched a product.", url: "https://d.com/4" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.overallConfidence, "high");
});

test("overallConfidence: low when the email domain is mismatched, even with substantial company evidence", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "company-generic", content: "Stampsize raised funding.", url: "https://c.com/3" }),
    result({ purpose: "company-generic", content: "Stampsize launched a product.", url: "https://d.com/4" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "mismatch", companyNameIsCommon: false });
  assert.equal(confidence.company.verified, true);
  assert.equal(confidence.overallConfidence, "low");
});

test("overallConfidence: low when there is no evidence at all", () => {
  const { confidence } = scoreEvidence([], lead({}), { emailDomainEvidence: "none", companyNameIsCommon: false });
  assert.equal(confidence.overallConfidence, "low");
  assert.equal(confidence.person.score, 0);
  assert.equal(confidence.company.score, 0);
});

test("overallConfidence: capped at medium when person is verified DESPITE a contradicted email domain — never high", () => {
  const results: TaggedSearchResult[] = [
    result({ purpose: "person-at-company", content: "Jane Doe is a VP at Stampsize.", url: "https://www.linkedin.com/in/janedoe" }),
    result({ purpose: "person-at-company", content: "Our team page lists Jane Doe as a VP at Stampsize.", url: "https://stampsize.com/team" }),
    result({ purpose: "company-generic", content: "Stampsize raised funding.", url: "https://c.com/3" }),
    result({ purpose: "company-generic", content: "Stampsize launched a product.", url: "https://d.com/4" }),
  ];
  const { confidence } = scoreEvidence(results, lead({}), { emailDomainEvidence: "mismatch", companyNameIsCommon: false });
  assert.equal(confidence.person.verified, true);
  assert.equal(confidence.company.verified, true);
  assert.equal(confidence.overallConfidence, "medium"); // NOT "high" — the unresolved contradiction caps it
});

// --- applyConfidenceSafeguards -------------------------------------------

function evidenceScore(overrides: Partial<EvidenceScore>): EvidenceScore {
  return { score: 0, threshold: 6, verified: false, contradicted: false, independentSources: 0, ...overrides };
}

function confidenceResult(overrides: Partial<ResearchConfidenceResult>): ResearchConfidenceResult {
  return {
    person: evidenceScore({}),
    company: evidenceScore({ threshold: 2 }),
    overallConfidence: "low",
    emailDomainEvidence: "none",
    companyNameIsCommon: false,
    reasons: [],
    ...overrides,
  };
}

test("applyConfidenceSafeguards: verified and not contradicted -> companyOverview untouched, painPoints preserved", () => {
  const generated = { companyOverview: "Acme is a widget maker.", painPoints: ["Scaling manufacturing"] };
  const confidence = confidenceResult({ person: evidenceScore({ verified: true, score: 9 }) });
  const result = applyConfidenceSafeguards(generated, confidence);
  assert.equal(result.companyOverview, "Acme is a widget maker.");
  assert.deepEqual(result.painPoints, ["Scaling manufacturing"]);
});

test("applyConfidenceSafeguards: verified DESPITE a contradiction -> explicit note prepended, but painPoints still preserved", () => {
  const generated = { companyOverview: "Aiera is a fintech AI company.", painPoints: ["Scaling AI research"] };
  const confidence = confidenceResult({ person: evidenceScore({ verified: true, contradicted: true, score: 7 }) });
  const result = applyConfidenceSafeguards(generated, confidence);
  assert.match(result.companyOverview!, /verified through independent evidence/i);
  assert.match(result.companyOverview!, /email domain does not match/i);
  assert.ok(result.companyOverview!.includes("Aiera is a fintech AI company."));
  assert.deepEqual(result.painPoints, ["Scaling AI research"]); // still kept — the person IS verified
});

test("applyConfidenceSafeguards: unverified AND contradicted -> warning explains BOTH insufficient evidence and the domain mismatch; painPoints stripped", () => {
  const generated = { companyOverview: "Aiera is a fintech AI company.", painPoints: ["Speculative pain point"] };
  const confidence = confidenceResult({ person: evidenceScore({ verified: false, contradicted: true, score: 2 }) });
  const result = applyConfidenceSafeguards(generated, confidence);
  assert.match(result.companyOverview!, /unverified/i);
  assert.match(result.companyOverview!, /insufficient to confirm/i);
  assert.match(result.companyOverview!, /email domain not matching/i);
  assert.deepEqual(result.painPoints, []);
});

test("applyConfidenceSafeguards: unverified and NOT contradicted -> generic insufficient-evidence wording, no mismatch language; painPoints stripped", () => {
  const generated = { companyOverview: "Acme is a widget maker.", painPoints: ["Speculative pain point"] };
  const confidence = confidenceResult({ person: evidenceScore({ verified: false, contradicted: false, score: 0 }) });
  const result = applyConfidenceSafeguards(generated, confidence);
  assert.match(result.companyOverview!, /could not be independently confirmed/i);
  assert.doesNotMatch(result.companyOverview!, /email domain/i);
  assert.deepEqual(result.painPoints, []);
});
