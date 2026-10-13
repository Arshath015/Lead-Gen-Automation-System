import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessEmailDomain,
  isCommonCompanyName,
  domainLabelMatchesCompany,
  computeIdentitySignals,
  buildResearchStrategyList,
  type LeadIdentityInput,
} from "./researchIdentity";

function lead(overrides: Partial<LeadIdentityInput>): LeadIdentityInput {
  return {
    fullName: "Jane Doe",
    title: null,
    company: null,
    companyDomain: null,
    email: null,
    linkedinUrl: null,
    location: null,
    ...overrides,
  };
}

// --- assessEmailDomain -------------------------------------------------

test("assessEmailDomain: no email -> none", () => {
  assert.equal(assessEmailDomain(null, "Acme Corp", null), "none");
});

test("assessEmailDomain: free-mail provider is neither a confirmation nor a mismatch", () => {
  assert.equal(assessEmailDomain("jane@gmail.com", "Acme Corp", null), "personal-provider");
  assert.equal(assessEmailDomain("jane@yahoo.com", "Totally Unrelated Inc", null), "personal-provider");
});

test("assessEmailDomain: domain overlaps the (suffix-stripped) company name -> confirms", () => {
  assert.equal(assessEmailDomain("jane@acme.com", "Acme Corp", null), "confirms");
  assert.equal(assessEmailDomain("jane@stampsize.com", "Stampsize", null), "confirms");
});

test("assessEmailDomain: stored companyDomain matches exactly -> confirms, even if the free-text company name wouldn't fuzzy-match", () => {
  assert.equal(assessEmailDomain("jane@acme.io", "Acme Corporation International Group", "acme.io"), "confirms");
});

test("assessEmailDomain: stored companyDomain present but different -> mismatch, overriding a would-be name-based confirmation", () => {
  assert.equal(assessEmailDomain("jane@acme.com", "Acme Corp", "other-domain.io"), "mismatch");
});

test("assessEmailDomain: domain unrelated to company name -> mismatch", () => {
  assert.equal(assessEmailDomain("jane@randomcorp.io", "Stampsize", null), "mismatch");
});

test("assessEmailDomain: email present but no company/domain to compare against -> none", () => {
  assert.equal(assessEmailDomain("jane@somecorp.com", null, null), "none");
});

// --- domainLabelMatchesCompany -------------------------------------------

test("domainLabelMatchesCompany: a real match (label reasonably long, contained in the company name)", () => {
  assert.equal(domainLabelMatchesCompany("stampsize.com", "Stampsize"), true);
  assert.equal(domainLabelMatchesCompany("acme.io", "Acme Corporation"), true);
});

test("domainLabelMatchesCompany: a short domain label is NOT treated as matching just because the company name happens to contain that letter sequence", () => {
  // "stampsize" contains the letter "a" and the substring "am" — a naive
  // substring check without a length floor would wrongly call these matches.
  assert.equal(domainLabelMatchesCompany("a.com", "Stampsize"), false);
  assert.equal(domainLabelMatchesCompany("am.io", "Stampsize"), false);
});

test("domainLabelMatchesCompany: an unrelated, ordinary-length domain does not match", () => {
  assert.equal(domainLabelMatchesCompany("equityzen.com", "Stampsize"), false);
});

// --- isCommonCompanyName ------------------------------------------------

test("isCommonCompanyName: a single generic business word is common", () => {
  assert.equal(isCommonCompanyName("Apex"), true);
  assert.equal(isCommonCompanyName("Summit"), true);
  assert.equal(isCommonCompanyName("Solutions"), true);
});

test("isCommonCompanyName: a very short name (<=3 chars) is treated as common regardless of the word", () => {
  assert.equal(isCommonCompanyName("ABC"), true);
});

test("isCommonCompanyName: a multi-word name made entirely of generic words is common", () => {
  assert.equal(isCommonCompanyName("Global Solutions"), true);
  assert.equal(isCommonCompanyName("Summit Partners Group"), true);
});

test("isCommonCompanyName: a distinctive company name is not flagged", () => {
  assert.equal(isCommonCompanyName("Stampsize"), false);
  assert.equal(isCommonCompanyName("Sedona Technologies"), false);
});

// --- computeIdentitySignals ---------------------------------------------

test("computeIdentitySignals: aggregates hasPerson/hasCompany/hasLinkedin/emailDomainEvidence/companyNameIsCommon consistently", () => {
  const signals = computeIdentitySignals(lead({ fullName: "Jane Doe", company: "Apex", email: "jane@apex.com", linkedinUrl: "https://linkedin.com/in/jane" }));
  assert.equal(signals.hasPerson, true);
  assert.equal(signals.hasCompany, true);
  assert.equal(signals.hasLinkedin, true);
  assert.equal(signals.emailDomainEvidence, "confirms");
  assert.equal(signals.companyNameIsCommon, true);
});

test("computeIdentitySignals: fullName 'Unknown' is treated as no usable person", () => {
  assert.equal(computeIdentitySignals(lead({ fullName: "Unknown" })).hasPerson, false);
});

// --- buildResearchStrategyList -------------------------------------------

test("strategy list: a fully sparse lead (no company, no LinkedIn, no title) still gets a LinkedIn-discovery query plus a bare-name fallback", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe" }));
  assert.equal(queries.length, 2);
  assert.ok(queries.every((q) => q.purpose === "person-identity"));
  // LinkedIn-discovery (medium) ranks above the bare-name fallback (weak).
  assert.equal(queries[0].strength, "medium");
  assert.equal(queries[1].strength, "weak");
});

test("strategy list: a truly empty lead (no usable name, no company, no LinkedIn) produces zero queries", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Unknown", company: null }));
  assert.deepEqual(queries, []);
});

test("strategy list: an already-known LinkedIn URL produces a strong verified-profile query", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", linkedinUrl: "https://linkedin.com/in/jane" }));
  const linkedinQuery = queries.find((q) => q.query.toLowerCase().includes("linkedin"));
  assert.equal(linkedinQuery?.strength, "strong");
});

test("strategy list: no stored LinkedIn URL still produces a domain-restricted LinkedIn-discovery query, distinct from and weaker than a verified one", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", company: "Stampsize" }));
  // Restricted via searchOptions.includeDomains now, not embedded as a
  // "linkedin" keyword in the query text — see researchIdentity.ts.
  const linkedinQuery = queries.find((q) => q.searchOptions?.includeDomains?.includes("linkedin.com"));
  assert.ok(linkedinQuery);
  assert.equal(linkedinQuery?.strength, "medium");
  assert.equal(linkedinQuery?.query, "Jane Doe Stampsize");
});

test("strategy list: an already-verified LinkedIn URL also requests raw content and advanced search depth", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", linkedinUrl: "https://linkedin.com/in/jane" }));
  const linkedinQuery = queries.find((q) => q.searchOptions?.includeDomains?.includes("linkedin.com"));
  assert.equal(linkedinQuery?.strength, "strong");
  assert.equal(linkedinQuery?.searchOptions?.includeRawContent, true);
  assert.equal(linkedinQuery?.searchOptions?.searchDepth, "advanced");
});

test("strategy list: a title that's too short/generic to quote ('AI', 'VP', etc.) is omitted from the title-qualified query, not included as noise", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", company: "Stampsize", title: "AI" }));
  assert.ok(!queries.some((q) => q.query.includes('"AI"')));
});

test("strategy list: a genuinely distinctive title IS included in the title-qualified query", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", company: "Stampsize", title: "VP Engineering" }));
  assert.ok(queries.some((q) => q.query === '"Jane Doe" "Stampsize" "VP Engineering"'));
});

test("strategy list: person+company also produces an unquoted natural-language variant and a question-form query, alongside the quoted one", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", company: "Stampsize" }));
  assert.ok(queries.some((q) => q.query === '"Jane Doe" "Stampsize"'));
  assert.ok(queries.some((q) => q.query === "Jane Doe Stampsize"));
  assert.ok(queries.some((q) => q.query === "Who is Jane Doe at Stampsize?"));
});

test("strategy list: a stored company domain restricts its person query to that exact domain via searchOptions", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", company: "Apex", companyDomain: "apex.com" }));
  const domainQuery = queries.find((q) => q.query.includes("apex.com") && q.purpose === "person-at-company");
  assert.deepEqual(domainQuery?.searchOptions?.includeDomains, ["apex.com"]);
});

test("strategy list: a company domain on file produces a person+domain-anchored query", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", company: "Apex", companyDomain: "apex.com" }));
  assert.ok(queries.some((q) => q.query.includes("apex.com") && q.purpose === "person-at-company"));
  assert.ok(queries.some((q) => q.purpose === "company-generic" && q.query.includes("apex.com")));
});

test("strategy list: person+company queries are downgraded to weak when the email domain is mismatched", () => {
  const queries = buildResearchStrategyList(lead({ fullName: "Jane Doe", company: "Stampsize", email: "jane@totallyunrelated.io" }));
  const personAtCompany = queries.filter((q) => q.purpose === "person-at-company");
  assert.ok(personAtCompany.length > 0);
  assert.ok(personAtCompany.every((q) => q.strength === "weak"));
});

test("strategy list: within each purpose queries are strongest-first, and the list is deduplicated", () => {
  const queries = buildResearchStrategyList(
    lead({ fullName: "Jane Doe", title: "VP Engineering", company: "Stampsize", email: "jane@stampsize.com", linkedinUrl: "https://linkedin.com/in/jane" })
  );
  const strengthRank = { strong: 3, medium: 2, weak: 1 };
  const byPurpose = new Map<string, typeof queries>();
  for (const q of queries) {
    const list = byPurpose.get(q.purpose) ?? [];
    list.push(q);
    byPurpose.set(q.purpose, list);
  }
  for (const list of byPurpose.values()) {
    for (let i = 1; i < list.length; i++) {
      assert.ok(strengthRank[list[i - 1].strength] >= strengthRank[list[i].strength]);
    }
  }
  const seen = new Set(queries.map((q) => q.query.toLowerCase()));
  assert.equal(seen.size, queries.length);
});

test("strategy list: purposes are round-robined so company-generic queries can't be crowded out of the round budget by however many person strategies exist", () => {
  // Regression guard: this lead has enough person-focused candidates (title +
  // company + confirmed email + stored LinkedIn) that a flat global
  // strength sort used to place every person-purpose query ahead of both
  // company-generic queries, pushing them past researchLoop.ts's round
  // budget entirely — the observable symptom was research briefs with no
  // fresh company evidence at all.
  const queries = buildResearchStrategyList(
    lead({ fullName: "Jane Doe", title: "VP Engineering", company: "Stampsize", email: "jane@stampsize.com", linkedinUrl: "https://linkedin.com/in/jane" })
  );
  const purposesPresent = new Set(queries.map((q) => q.purpose)).size;
  const companyGenericIndex = queries.findIndex((q) => q.purpose === "company-generic");
  assert.ok(companyGenericIndex !== -1, "expected at least one company-generic candidate for this lead");
  // Round-robining guarantees every present purpose gets a turn within the
  // first pass across all purposes (one slot per purpose per pass).
  assert.ok(
    companyGenericIndex < purposesPresent,
    `expected company-generic within the first round-robin pass (index ${companyGenericIndex}, ${purposesPresent} purposes present)`
  );
});
