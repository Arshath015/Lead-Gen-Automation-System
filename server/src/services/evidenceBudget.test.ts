import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetEvidenceForPrompt, MAX_CONTENT_CHARS_PER_ITEM, MAX_TOTAL_EVIDENCE_CHARS } from "./evidenceBudget";
import type { ScoredEvidenceResult } from "./researchEvidence";

function evidence(overrides: Partial<ScoredEvidenceResult>): ScoredEvidenceResult {
  return {
    title: "Title",
    url: "https://example.com/1",
    content: "Some content",
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

test("budgetEvidenceForPrompt: oversized raw_content on a single item is truncated to the per-item cap", () => {
  const huge = "x".repeat(20000); // simulates includeRawContent: true returning a full page
  const [result] = budgetEvidenceForPrompt([evidence({ content: huge })]);
  assert.ok(result.content.length <= MAX_CONTENT_CHARS_PER_ITEM + 1); // +1 for the ellipsis character
  assert.ok(result.content.endsWith("…"));
});

test("budgetEvidenceForPrompt: content already under the per-item cap is left untouched", () => {
  const short = "A short snippet.";
  const [result] = budgetEvidenceForPrompt([evidence({ content: short })]);
  assert.equal(result.content, short);
});

test("budgetEvidenceForPrompt: the combined total across all kept items never exceeds the configured total budget", () => {
  // 20 items, each right at the per-item cap -> 20 * 700 = 14,000 chars raw,
  // well over the default 8,000-char total budget.
  const items = Array.from({ length: 20 }, (_, i) =>
    evidence({ content: "y".repeat(MAX_CONTENT_CHARS_PER_ITEM), url: `https://example.com/${i}`, fingerprint: `fp-${i}` })
  );
  const result = budgetEvidenceForPrompt(items);
  const totalChars = result.reduce((sum, e) => sum + e.content.length, 0);
  assert.ok(totalChars <= MAX_TOTAL_EVIDENCE_CHARS);
  assert.ok(result.length < items.length); // some were actually dropped, not just silently kept over budget
});

test("budgetEvidenceForPrompt: prioritizes evidence that actually contributed to the person score over company-generic evidence when trimming", () => {
  const personEvidence = evidence({
    purpose: "person-at-company",
    mentionsPerson: true,
    mentionsCompany: true,
    content: "z".repeat(MAX_CONTENT_CHARS_PER_ITEM),
    url: "https://linkedin.com/in/person",
    fingerprint: "person-fp",
  });
  const companyEvidence = Array.from({ length: 15 }, (_, i) =>
    evidence({
      purpose: "company-generic",
      content: "w".repeat(MAX_CONTENT_CHARS_PER_ITEM),
      url: `https://company-news.com/${i}`,
      fingerprint: `company-fp-${i}`,
    })
  );

  // Person evidence placed LAST in the input array — priority ordering must
  // still surface it, not just preserve input order.
  const result = budgetEvidenceForPrompt([...companyEvidence, personEvidence]);

  assert.ok(result.some((e) => e.fingerprint === "person-fp"), "the person-qualifying evidence must survive trimming");
  assert.ok(result.length < companyEvidence.length + 1, "at least some company-generic evidence was dropped to make room");
});

test("budgetEvidenceForPrompt: a person-identity hit that actually names the person outranks a person-at-company hit that doesn't name the company", () => {
  const weakPersonAtCompany = evidence({
    purpose: "person-at-company",
    mentionsPerson: true,
    mentionsCompany: false, // didn't actually qualify for scoring — see researchEvidence.ts
    content: "unrelated content",
    fingerprint: "weak",
  });
  const strongIdentity = evidence({
    purpose: "person-identity",
    mentionsPerson: true,
    content: "z".repeat(MAX_CONTENT_CHARS_PER_ITEM),
    fingerprint: "strong",
  });
  const filler = Array.from({ length: 15 }, (_, i) =>
    evidence({ content: "w".repeat(MAX_CONTENT_CHARS_PER_ITEM), fingerprint: `filler-${i}`, url: `https://x.com/${i}` })
  );

  const result = budgetEvidenceForPrompt([weakPersonAtCompany, ...filler, strongIdentity]);
  const strongIndex = result.findIndex((e) => e.fingerprint === "strong");
  const weakIndex = result.findIndex((e) => e.fingerprint === "weak");
  assert.ok(strongIndex !== -1, "the qualifying person-identity hit must survive");
  // The non-qualifying hit ranks in tier 1, qualifying evidence in tier 0 —
  // if both survive, the qualifying one must appear first.
  if (weakIndex !== -1) assert.ok(strongIndex < weakIndex);
});

test("budgetEvidenceForPrompt: always keeps at least one item even if a tiny configured budget can't fit it", () => {
  const [result] = [
    budgetEvidenceForPrompt([evidence({ content: "some evidence content" })], { maxTotalEvidenceChars: 1, maxContentCharsPerItem: 5000 }),
  ];
  assert.equal(result.length, 1);
});

test("budgetEvidenceForPrompt: custom options are honored instead of the module defaults", () => {
  const items = [evidence({ content: "a".repeat(100) }), evidence({ content: "b".repeat(100), fingerprint: "fp2", url: "https://example.com/2" })];
  const result = budgetEvidenceForPrompt(items, { maxContentCharsPerItem: 20, maxTotalEvidenceChars: 25 });
  assert.ok(result[0].content.length <= 21); // 20 + ellipsis
  const total = result.reduce((sum, e) => sum + e.content.length, 0);
  assert.ok(total <= 25);
});

test("budgetEvidenceForPrompt: empty evidence list returns an empty list, not an error", () => {
  assert.deepEqual(budgetEvidenceForPrompt([]), []);
});

test("budgetEvidenceForPrompt: company-generic evidence survives a reserved floor even when person evidence alone would otherwise consume the entire budget", () => {
  // Regression guard: `includeRawContent: true` can return several full-page
  // person-purpose results (e.g. across multiple person-at-company/person-
  // identity queries), each near the per-item cap. 12 such items alone
  // already exceed MAX_TOTAL_EVIDENCE_CHARS (8,000) — the old tier-only
  // greedy fill (person tier filled first, company tier only got whatever
  // was left) would zero out company-generic evidence entirely in this
  // case, which is exactly the "brief reads as person-only" symptom this
  // fix addresses.
  const personEvidence = Array.from({ length: 12 }, (_, i) =>
    evidence({
      purpose: "person-at-company",
      mentionsPerson: true,
      mentionsCompany: true,
      content: "p".repeat(MAX_CONTENT_CHARS_PER_ITEM),
      url: `https://press.example.com/${i}`,
      fingerprint: `person-fp-${i}`,
    })
  );
  const companyEvidence = [
    evidence({ content: "Company overview source one.", url: "https://company.example.com/about", fingerprint: "company-fp-1" }),
    evidence({ content: "Company overview source two.", url: "https://company.example.com/news", fingerprint: "company-fp-2" }),
  ];

  const result = budgetEvidenceForPrompt([...personEvidence, ...companyEvidence]);

  const keptCompanyCount = result.filter((e) => e.purpose === "company-generic").length;
  assert.ok(keptCompanyCount > 0, "company-generic evidence must not be trimmed to zero just because person evidence is abundant");
  assert.ok(result.some((e) => e.fingerprint === "company-fp-1") || result.some((e) => e.fingerprint === "company-fp-2"));
  const totalChars = result.reduce((sum, e) => sum + e.content.length, 0);
  assert.ok(totalChars <= MAX_TOTAL_EVIDENCE_CHARS);
});

test("budgetEvidenceForPrompt: when person evidence is sparse, company-generic can still use the full remaining budget, not just its reserved floor", () => {
  // The reserve is a floor, not a cap — with little/no competing person
  // evidence, company-generic should fill up to the real total budget.
  const companyEvidence = Array.from({ length: 15 }, (_, i) =>
    evidence({ content: "c".repeat(MAX_CONTENT_CHARS_PER_ITEM), url: `https://company.example.com/${i}`, fingerprint: `company-fp-${i}` })
  );

  const result = budgetEvidenceForPrompt(companyEvidence);

  const totalChars = result.reduce((sum, e) => sum + e.content.length, 0);
  // 15 * 700 = 10,500 > 8,000, so not everything fits, but far more than the
  // ~2-item reserve floor should be kept since nothing else competes for budget.
  assert.ok(result.length > 2, `expected more than the reserved floor to be kept, got ${result.length}`);
  assert.ok(totalChars <= MAX_TOTAL_EVIDENCE_CHARS);
});
