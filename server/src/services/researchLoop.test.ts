import { test } from "node:test";
import assert from "node:assert/strict";
import { runResearchLoop, type SearchFn } from "./researchLoop";
import { scoreEvidence } from "./researchEvidence";
import type { LeadIdentityInput } from "./researchIdentity";
import type { SearchResultItem } from "../search/ISearchAdapter";

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

function item(overrides: Partial<SearchResultItem>): SearchResultItem {
  return { title: "Title", url: "https://example.com/1", content: "Content", publishedDate: null, ...overrides };
}

// Builds a fake search function from an exact-match query->results table, so
// each test can control precisely what each planned query "finds" without
// any real Tavily call. Throws loudly if the loop asks a query the test
// didn't anticipate, so a test failure points at a real behavior change
// rather than silently returning nothing. Ignores the third (searchOptions)
// argument — tests that specifically need to verify options are forwarded
// use their own inline fake instead (see "searchOptions are forwarded").
function fakeSearch(table: Record<string, SearchResultItem[]>): SearchFn {
  return async (query: string) => {
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };
}

// --- Scenario: sparse name+company+email, a LATER LinkedIn-focused query finds the person ---

test("sparse lead: round 1 (question-form + quoted person+company) is insufficient alone; round 2's company-generic and domain-restricted LinkedIn queries push both dimensions past threshold", async () => {
  // No title: candidates are [quoted person+company (strong, email
  // confirms), unquoted variant (medium), question-form (medium),
  // LinkedIn-domain-restricted (medium), company-generic (medium)], but
  // round scheduling round-robins across purposes (person-identity,
  // person-at-company, company-generic) rather than a flat strength sort, so
  // company-generic isn't crowded out by however many person candidates
  // exist. Round 1 = [question-form, quoted]; round 2 = [company-generic, linkedin].
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize", email: "jane@stampsize.com" });

  const round1Only = [
    item({ url: "https://a.com/1", content: "Stampsize is a company building outreach tools. No specific employee named here." }),
    item({ url: "https://a.com/2", content: "Stampsize overview: outreach automation for small teams." }),
  ];
  // Prove round 1 alone (email-confirms bonus + no name mentions) is not enough.
  const round1Confidence = scoreEvidence(
    round1Only.map((r) => ({ ...r, purpose: "person-at-company" as const, strength: "strong" as const })),
    theLead,
    { emailDomainEvidence: "confirms", companyNameIsCommon: false }
  ).confidence;
  assert.equal(round1Confidence.person.verified, false);

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize"': [item({ url: "https://a.com/1", content: "Stampsize is a company building outreach tools. No specific employee named here." })],
    "Jane Doe Stampsize": [item({ url: "https://a.com/2", content: "Stampsize overview: outreach automation for small teams." })],
    "Who is Jane Doe at Stampsize?": [],
    "Stampsize company overview recent news": [
      item({ url: "https://b.com/1", content: "Stampsize raised a funding round this year." }),
      item({ url: "https://b.com/2", content: "Stampsize launched a new product this quarter." }),
    ],
  };
  // The LinkedIn-discovery query shares its query TEXT with the unquoted
  // person+company query above ("Jane Doe Stampsize") but is a distinct,
  // domain-restricted search — the fake distinguishes them by call order
  // isn't possible with a plain text table, so this test uses a small
  // wrapper that keys on (query, includeDomains) instead.
  const search: SearchFn = async (query, _max, options) => {
    if (query === "Jane Doe Stampsize" && options?.includeDomains?.includes("linkedin.com")) {
      return [
        item({ url: "https://www.linkedin.com/in/janedoe", title: "Jane Doe - Stampsize", content: "Jane Doe works at Stampsize as an engineer." }),
      ];
    }
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);

  // Both dimensions now verify by round 2 — company-generic evidence is no
  // longer starved out until a hypothetical round 3 that might never come;
  // it runs early enough that the loop can stop as soon as both dimensions
  // are actually satisfied.
  assert.equal(result.roundsRun, 2);
  assert.equal(result.queriesRun.length, 4);
  assert.equal(result.confidence.person.verified, true);
  assert.equal(result.confidence.company.verified, true);
  assert.equal(result.confidence.overallConfidence, "high");
});

// --- Scenario: sparse lead where no person evidence exists anywhere ---

test("sparse lead, no person evidence exists after exhausting every strategy: company facts still separately verified, person stays unverified (not contradicted)", async () => {
  // No title, no email, no LinkedIn, no domain -> 5 candidates: quoted,
  // unquoted, question-form, LinkedIn-discovery, company-generic (all medium).
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize" });

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize"': [item({ url: "https://a.com/1", content: "Stampsize overview, no employee names mentioned." })],
    "Jane Doe Stampsize": [item({ url: "https://a.com/2", content: "More Stampsize overview text, still no names." })],
    "Who is Jane Doe at Stampsize?": [],
    "Stampsize company overview recent news": [
      item({ url: "https://b.com/1", content: "Stampsize raised funding this year." }),
      item({ url: "https://b.com/2", content: "Stampsize launched a product this quarter." }),
    ],
  };
  const search: SearchFn = async (query, _max, options) => {
    if (query === "Jane Doe Stampsize" && options?.includeDomains?.includes("linkedin.com")) return [];
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);

  assert.equal(result.queriesRun.length, 5); // exhausted every candidate — nothing left to try
  assert.equal(result.confidence.person.score, 0);
  assert.equal(result.confidence.person.verified, false);
  assert.equal(result.confidence.person.contradicted, false); // not contradicted, just absent
  assert.equal(result.confidence.company.verified, true);
  assert.equal(result.confidence.overallConfidence, "low");
});

// --- Scenario: common company name ---

test("common company name: company verification requires the raised threshold, reached only after an extra round", async () => {
  const theLead = lead({ fullName: "Jane Doe", company: "Apex" });

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Apex"': [],
    "\"Jane Doe\" Apex linkedin": [],
    "Apex company overview recent news": [
      item({ url: "https://a.com/1", content: "Apex raised funding this year." }),
      item({ url: "https://a.com/2", content: "Apex launched a product this quarter." }),
      item({ url: "https://a.com/3", content: "Apex expanded into a new region this month." }),
    ],
  };

  const result = await runResearchLoop(theLead, fakeSearch(table));

  assert.equal(result.confidence.companyNameIsCommon, true);
  assert.equal(result.confidence.company.threshold, 3); // raised from the default 2
  assert.equal(result.confidence.company.verified, true); // 3 independent sources met the raised bar
  assert.equal(result.confidence.person.verified, false);
});

// --- Scenario: mismatched email domain ---

test("mismatched email domain: does NOT stop the loop early just because company is verified — keeps searching for person evidence across all 3 rounds", async () => {
  // Mismatched, no title/domain/linkedin -> 5 candidates: LinkedIn-discovery
  // (promoted to strong), question-form (medium), company-generic (medium),
  // quoted person+company (weak), unquoted variant (weak).
  // Round 1 = [linkedin, question]; round 2 = [company-generic, quoted-weak]; round 3 = [unquoted-weak].
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize", email: "jane@totallyunrelated.io" });

  const table: Record<string, SearchResultItem[]> = {
    "Who is Jane Doe at Stampsize?": [],
    "Stampsize company overview recent news": [
      item({ url: "https://a.com/1", content: "Stampsize raised funding this year." }),
      item({ url: "https://a.com/2", content: "Stampsize launched a product this quarter." }),
    ],
    '"Jane Doe" "Stampsize"': [
      item({ url: "https://stampsize.com/team", content: "Our team page lists Jane Doe as an engineer at Stampsize." }),
    ],
    "Jane Doe Stampsize": [
      item({ url: "https://press.example.com/1", content: "In a press quote, Jane Doe described her work at Stampsize." }),
    ],
  };
  const search: SearchFn = async (query, _max, options) => {
    if (options?.includeDomains?.includes("linkedin.com")) {
      return [item({ url: "https://www.linkedin.com/in/janedoe", title: "Jane Doe - Stampsize", content: "Jane Doe works at Stampsize." })];
    }
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);

  // Company verifies as early as round 2, but the loop keeps going through
  // round 3 anyway because person isn't verified yet — the old hard-cap
  // behavior would have stopped the instant company verified.
  assert.equal(result.roundsRun, 3);
  assert.equal(result.queriesRun.length, 5); // every candidate ran, nothing skipped
  assert.equal(result.confidence.person.contradicted, true);
  assert.equal(result.confidence.person.verified, true); // 3 independent corroborating sources outweighed the contradiction
  assert.equal(result.confidence.company.verified, true);
  assert.equal(result.confidence.overallConfidence, "medium"); // capped, not "high", due to the unresolved contradiction
});

test("mismatched email domain with genuinely no person evidence anywhere: exhausts every strategy across all 3 rounds rather than stopping once company verifies", async () => {
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize", email: "jane@totallyunrelated.io" });

  const table: Record<string, SearchResultItem[]> = {
    "Who is Jane Doe at Stampsize?": [],
    "Stampsize company overview recent news": [
      item({ url: "https://a.com/1", content: "Stampsize raised funding this year." }),
      item({ url: "https://a.com/2", content: "Stampsize launched a product this quarter." }),
    ],
    '"Jane Doe" "Stampsize"': [],
    "Jane Doe Stampsize": [],
  };
  const search: SearchFn = async (query, _max, options) => {
    if (options?.includeDomains?.includes("linkedin.com")) return [];
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);

  // Since person can never verify with zero qualifying evidence, isSufficient
  // never becomes true, so the loop necessarily runs every round/candidate —
  // this is the direct, observable consequence of removing the hard-cap
  // shortcut from the stopping condition.
  assert.equal(result.queriesRun.length, 5);
  assert.equal(result.roundsRun, 3);
  assert.equal(result.confidence.person.contradicted, true);
  assert.equal(result.confidence.person.verified, false);
  assert.equal(result.confidence.company.verified, true);
  assert.equal(result.confidence.overallConfidence, "low");
  assert.ok(result.confidence.reasons.some((r) => r.toLowerCase().includes("insufficient to confirm")));
});

// --- Scenario: conflicting search results ---

test("conflicting search results: a same-named hit unrelated to the company is ignored; only a genuine co-mention counts", async () => {
  // No title/email/linkedin/domain -> 5 candidates: quoted, unquoted,
  // question-form, LinkedIn-discovery, company-generic (all medium).
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize" });

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize"': [
      // Same name, but this snippet is about something else entirely and never mentions Stampsize.
      item({ url: "https://unrelated.com/1", title: "Jane Doe wins local baking contest", content: "Jane Doe took first prize at the county fair baking contest." }),
    ],
    "Jane Doe Stampsize": [],
    "Who is Jane Doe at Stampsize?": [],
    "Stampsize company overview recent news": [
      item({ url: "https://b.com/1", content: "Stampsize raised funding this year." }),
      item({ url: "https://b.com/2", content: "Stampsize launched a product this quarter." }),
    ],
  };
  const search: SearchFn = async (query, _max, options) => {
    if (query === "Jane Doe Stampsize" && options?.includeDomains?.includes("linkedin.com")) {
      return [item({ url: "https://www.linkedin.com/in/janedoe", title: "Jane Doe - Stampsize", content: "Jane Doe works at Stampsize as an engineer." })];
    }
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);

  // The baking-contest hit must not have contributed — only the LinkedIn co-mention should count.
  const unrelatedHit = result.evidence.find((e) => e.url === "https://unrelated.com/1");
  assert.ok(unrelatedHit);
  assert.equal(unrelatedHit!.mentionsPerson, true);
  assert.equal(unrelatedHit!.mentionsCompany, false);
  assert.equal(result.confidence.person.independentSources, 1); // only the LinkedIn hit counted
});

// --- Scenario: repeated syndicated copies of the same source ---

test("repeated syndicated copies of the same press release (different domains) count as one source, not several", async () => {
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize" });
  const syndicated = "Stampsize today announced a major new partnership with a leading enterprise software vendor.";

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize"': [],
    "\"Jane Doe\" Stampsize linkedin": [],
    "Stampsize company overview recent news": [
      item({ url: "https://siteA.com/1", content: syndicated }),
      item({ url: "https://siteB.com/1", content: syndicated }),
      item({ url: "https://siteC.com/1", content: syndicated }),
      item({ url: "https://siteD.com/1", content: syndicated }),
    ],
  };

  const result = await runResearchLoop(theLead, fakeSearch(table));

  // 4 syndicated copies collapse to 1 independent source -> below the company threshold of 2.
  assert.equal(result.confidence.company.independentSources, 1);
  assert.equal(result.confidence.company.verified, false);
});

// --- Scenario: strong LinkedIn/person evidence with corroborating company evidence ---

test("strong LinkedIn evidence verifies the person in round 1; company-generic is round-robined into round 1 too rather than starved to a later round", async () => {
  // Stored LinkedIn URL, no title -> 5 candidates: verified-LinkedIn (strong,
  // domain-restricted), quoted person+company (strong), unquoted (medium),
  // question-form (medium), company-generic (medium). Purposes present:
  // person-identity=[linkedin-verified], person-at-company=[quoted, unquoted],
  // company-generic=[overview]. Round-robin gives every purpose a turn in
  // round 1: round 1 = [linkedin-verified, quoted]... but person-identity has
  // only one candidate, so the next pass immediately reaches company-generic:
  // round 2 = [company-generic, question-form].
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize", linkedinUrl: "https://www.linkedin.com/in/janedoe" });

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize"': [
      item({ url: "https://stampsize.com/team", content: "Our engineer Jane Doe is part of the platform team at Stampsize." }),
    ],
    "Jane Doe Stampsize": [],
    "Who is Jane Doe at Stampsize?": [],
    "Stampsize company overview recent news": [
      item({ url: "https://b.com/1", content: "Stampsize raised funding this year." }),
      item({ url: "https://b.com/2", content: "Stampsize launched a product this quarter." }),
    ],
  };
  const search: SearchFn = async (query, _max, options) => {
    if (options?.includeDomains?.includes("linkedin.com")) {
      return [item({ url: "https://www.linkedin.com/in/janedoe", title: "Jane Doe - Stampsize", content: "Jane Doe works at Stampsize as an engineer." })];
    }
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);

  assert.equal(result.confidence.person.verified, true); // already true after round 1 alone (linkedin hit + team-page co-mention)
  assert.equal(result.roundsRun, 2); // company-generic runs in round 2 (round-robined, not starved behind every person candidate) and verifies immediately
  assert.equal(result.queriesRun.length, 4);
  assert.equal(result.confidence.company.verified, true);
  assert.equal(result.confidence.overallConfidence, "high");
});

// --- Scenario: threshold failure after all planned attempts ---

test("threshold failure: a richly-populated lead where NO strategy ever finds the person still terminates cleanly, fully inconclusive for person", async () => {
  const theLead = lead({ fullName: "Jane Doe", title: "VP Engineering", company: "Stampsize", companyDomain: "stampsize.com" });

  const noPersonMention = (url: string) => item({ url, content: "Generic content with no relevant names mentioned anywhere." });

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize" "VP Engineering"': [noPersonMention("https://a.com/1")],
    '"Jane Doe" "Stampsize"': [noPersonMention("https://a.com/2")],
    '"Jane Doe" stampsize.com': [noPersonMention("https://a.com/3")],
    "\"Jane Doe\" Stampsize linkedin": [],
    "Stampsize company overview recent news": [item({ url: "https://b.com/1", content: "Stampsize company overview." })],
    "stampsize.com company news": [item({ url: "https://b.com/2", content: "Stampsize product news." })],
  };

  const result = await runResearchLoop(theLead, fakeSearch(table));

  assert.equal(result.queriesRun.length, 6); // every planned strategy was tried
  assert.equal(result.roundsRun, 3);
  assert.equal(result.confidence.person.score, 0);
  assert.equal(result.confidence.person.verified, false);
  assert.equal(result.confidence.person.contradicted, false);
  assert.equal(result.confidence.overallConfidence, "low");
});

// --- Resilience: partial query failures are tolerated; total failure is not ---

test("a single query failing is tolerated as long as another succeeds", async () => {
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize" });
  const search: SearchFn = async (query) => {
    if (query === '"Jane Doe" "Stampsize"') throw new Error("transient provider error");
    return [item({ url: "https://a.com/1", content: "Stampsize company overview." }), item({ url: "https://a.com/2", content: "Stampsize news." })];
  };

  const result = await runResearchLoop(theLead, search);
  assert.equal(result.confidence.company.verified, true);
});

test("every query failing propagates an error rather than silently returning empty evidence", async () => {
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize" });
  const search: SearchFn = async () => {
    throw new Error("search provider is down");
  };

  await assert.rejects(() => runResearchLoop(theLead, search), /search provider/i);
});

// --- searchOptions are actually forwarded to the search function ---

test("searchOptions (includeDomains, includeRawContent, searchDepth) are forwarded from ResearchQuery to the search call, not silently dropped", async () => {
  // Bare name + a stored LinkedIn URL, no company -> 2 candidates:
  // linkedin-verified (strong) and a bare-name fallback (weak), both run in
  // round 1.
  const theLead = lead({ fullName: "Jane Doe", linkedinUrl: "https://linkedin.com/in/jane" });
  const calls: { query: string; options: Parameters<SearchFn>[2] }[] = [];

  const search: SearchFn = async (query, _max, options) => {
    calls.push({ query, options });
    return [];
  };

  await runResearchLoop(theLead, search);

  assert.equal(calls.length, 2);
  const linkedinCall = calls.find((c) => c.options?.includeDomains?.includes("linkedin.com"));
  assert.ok(linkedinCall);
  assert.equal(linkedinCall!.options?.includeRawContent, true);
  assert.equal(linkedinCall!.options?.searchDepth, "advanced");
});

// --- Adaptive follow-up: discovering the real company domain mid-loop ---

test("adaptive follow-up: a real company domain discovered from company-generic evidence gets its own dedicated, domain-restricted query in a later round", async () => {
  // No title/email/linkedin/companyDomain -> company's real site isn't known
  // up front. Candidates: quoted, unquoted, question-form, LinkedIn-discovery,
  // company-generic (all medium) — none reference "stampsize.com" yet.
  // Round-robining across purposes means company-generic now runs in round 2
  // (not starved to round 3), so the adaptive domain discovery — and its
  // dedicated follow-up query — both fit inside the original 3-round budget
  // without needing the bonus round.
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize" });

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize"': [],
    "Jane Doe Stampsize": [],
    "Who is Jane Doe at Stampsize?": [],
    // Company-generic turns up the company's own real site among third-party
    // mentions — this is what the adaptive step should notice and act on.
    "Stampsize company overview recent news": [
      item({ url: "https://equityzen.com/company/stampsize", content: "Stampsize is a lead-generation automation company." }),
      item({ url: "https://stampsize.com/about", content: "About Stampsize: we build outreach automation tools." }),
    ],
  };

  let adaptiveQuerySeen = false;
  const search: SearchFn = async (query, _max, options) => {
    if (options?.includeDomains?.includes("linkedin.com")) return [];
    if (options?.includeDomains?.includes("stampsize.com")) {
      adaptiveQuerySeen = true;
      assert.equal(query, "Jane Doe"); // adaptive query is the bare name, the domain restriction does the targeting
      // Two distinct pages on the discovered official site, both naming the
      // person alongside the company: base(3) + base(3) + corroboration(2) =
      // 8, clearing the threshold of 6. A single such hit deliberately
      // wouldn't be enough on its own (see the researchEvidence tests) —
      // this proves the adaptive query's evidence is scored by the same
      // unchanged rules as everything else, not given a free pass.
      return [
        item({ url: "https://stampsize.com/team", content: "Meet our team: Jane Doe, engineer at Stampsize." }),
        item({ url: "https://stampsize.com/blog/launch", content: "Stampsize's Jane Doe explains the new feature launch." }),
      ];
    }
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);

  assert.equal(adaptiveQuerySeen, true);
  assert.equal(result.roundsRun, 3); // company-generic ran in round 2, so the adaptive query fits in round 3 without needing the bonus round
  assert.equal(result.queriesRun.length, 6); // 5 planned + 1 adaptive
  assert.equal(result.confidence.person.verified, true);
});

test("adaptive follow-up: never triggers on a third-party/aggregator domain that merely mentions the company — only a domain whose own label matches the company name", async () => {
  const theLead = lead({ fullName: "Jane Doe", company: "Stampsize" });

  const table: Record<string, SearchResultItem[]> = {
    '"Jane Doe" "Stampsize"': [],
    "Jane Doe Stampsize": [],
    "Who is Jane Doe at Stampsize?": [],
    "Stampsize company overview recent news": [
      item({ url: "https://equityzen.com/company/stampsize", content: "Stampsize investor page." }),
      item({ url: "https://builtinnyc.com/company/stampsize", content: "Stampsize press coverage." }),
    ],
  };
  const search: SearchFn = async (query, _max, options) => {
    if (options?.includeDomains && !options.includeDomains.includes("linkedin.com")) {
      throw new Error(`Unexpected adaptive query against domain: ${options.includeDomains.join(",")}`);
    }
    if (options?.includeDomains?.includes("linkedin.com")) return [];
    if (!(query in table)) throw new Error(`Unexpected query in test: "${query}"`);
    return table[query];
  };

  const result = await runResearchLoop(theLead, search);
  assert.equal(result.queriesRun.length, 5); // no adaptive query added — neither domain's label matches "Stampsize"
  assert.equal(result.confidence.person.verified, false);
});
