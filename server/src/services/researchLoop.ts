// The iterative research loop: runs the strongest available query strategies
// first, scores the accumulated evidence, and only reaches for the next
// batch of (weaker/different) strategies when the evidence gathered so far
// isn't enough — rather than firing every possible query in one shot
// regardless of whether the first attempt already succeeded (wasteful) or
// already failed conclusively (pointless).
//
// `search` is injected rather than importing tavilyAdapter directly, so this
// entire loop — batching, early-stop, dedup, scoring interplay — is testable
// with a fake search function and zero network calls. research.routes.ts is
// the only real caller, and it passes tavilyAdapter.search bound to a fixed
// per-query result cap.

import type { SearchOptions, SearchResultItem } from "../search/ISearchAdapter";
import type { TaggedSearchResult } from "../llm/ILlmAdapter";
import {
  buildResearchStrategyList,
  computeIdentitySignals,
  domainLabelMatchesCompany,
  type LeadIdentityInput,
  type ResearchQuery,
} from "./researchIdentity";
import { scoreEvidence, type ScoredEvidenceResult, type ResearchConfidenceResult } from "./researchEvidence";

export type SearchFn = (query: string, maxResults: number, options?: SearchOptions) => Promise<SearchResultItem[]>;

const QUERIES_PER_ROUND = 2;
const MAX_ROUNDS = 3;
const RESULTS_PER_QUERY = 4;

// Adaptive follow-up: buildResearchStrategyList's candidate list is entirely
// static, computed once from the lead's own stored fields. But a lead with
// no stored companyDomain might still have one *discoverable* — the
// company-generic query often surfaces the company's own official site
// among third-party/press mentions. Once we see a company-generic hit whose
// domain actually matches the company name (not just an aggregator or press
// domain that happens to mention it), it's worth one dedicated, domain-
// restricted person query against that real site — evidence a purely static
// candidate list could never have known to ask for up front. Bounded to at
// most one such query per lead (via `adaptiveQueryAdded`) to keep this
// deterministic and cost-bounded, not an open-ended crawl.
function discoverOfficialDomain(evidence: ScoredEvidenceResult[], company: string | null, alreadyTried: Set<string>): string | null {
  if (!company) return null;
  for (const r of evidence) {
    if (r.purpose !== "company-generic" || !r.domain || alreadyTried.has(r.domain)) continue;
    if (domainLabelMatchesCompany(r.domain, company)) return r.domain;
  }
  return null;
}

export interface ResearchLoopResult {
  evidence: ScoredEvidenceResult[];
  confidence: ResearchConfidenceResult;
  queriesRun: ResearchQuery[];
  roundsRun: number;
}

// A round is "enough" once both dimensions are verified. Deliberately does
// NOT short-circuit on a contradicted email domain — that's a scoring
// penalty now (researchEvidence.ts), not a reason to stop searching. A
// mismatch must still be given the chance to be outweighed by independent
// evidence found in a later round, not treated as "nothing more to learn."
function isSufficient(confidence: ResearchConfidenceResult): boolean {
  return confidence.person.verified && confidence.company.verified;
}

export async function runResearchLoop(lead: LeadIdentityInput, search: SearchFn): Promise<ResearchLoopResult> {
  const candidates = buildResearchStrategyList(lead);
  const signals = computeIdentitySignals(lead);

  const rawResults: TaggedSearchResult[] = [];
  const queriesRun: ResearchQuery[] = [];
  let roundsRun = 0;
  let index = 0;
  let anyQuerySucceeded = false;
  let adaptiveQueryAdded = false;

  let scored = scoreEvidence(rawResults, lead, signals);

  // The adaptive query (below) is only discoverable from company-generic
  // evidence, which is deliberately deprioritized behind every person-
  // focused strategy — so it's often not seen until the very last regular
  // round, by which point MAX_ROUNDS is already exhausted. One bonus round
  // is allowed specifically to let that just-discovered query actually run,
  // rather than finding a genuinely promising lead and then never acting on
  // it. This never grants more than one extra round, and never fires unless
  // an adaptive query was actually added.
  while (index < candidates.length && roundsRun < MAX_ROUNDS + (adaptiveQueryAdded ? 1 : 0)) {
    const batch = candidates.slice(index, index + QUERIES_PER_ROUND);
    index += batch.length;
    roundsRun += 1;

    for (const q of batch) {
      queriesRun.push(q);
      try {
        const results = await search(q.query, RESULTS_PER_QUERY, q.searchOptions);
        anyQuerySucceeded = true;
        for (const r of results) rawResults.push({ ...r, purpose: q.purpose, strength: q.strength });
      } catch {
        // Tolerated here — a single strategy failing (transient provider
        // error) shouldn't sink the whole loop. Only "every query across
        // every round failed" is treated as a hard failure, below.
      }
    }

    scored = scoreEvidence(rawResults, lead, signals);
    if (isSufficient(scored.confidence)) break;

    // Adaptive step: if a real, matching company domain turned up in what
    // we've found so far (and we haven't already tried querying it, and
    // haven't already added one adaptive query this run), give it its own
    // dedicated, domain-restricted person query rather than only ever
    // running the queries computed before any evidence existed.
    if (!adaptiveQueryAdded) {
      const triedDomains = new Set(queriesRun.flatMap((q) => q.searchOptions?.includeDomains ?? []));
      const discovered = discoverOfficialDomain(scored.evidence, lead.company, triedDomains);
      if (discovered && signals.hasPerson) {
        candidates.push({
          query: lead.fullName.trim(),
          purpose: "person-at-company",
          strength: "strong",
          searchOptions: { includeDomains: [discovered], includeRawContent: true },
        });
        adaptiveQueryAdded = true;
      }
    }
  }

  if (queriesRun.length > 0 && !anyQuerySucceeded) {
    throw new Error("All research queries failed — the search provider may be unavailable.");
  }

  return { evidence: scored.evidence, confidence: scored.confidence, queriesRun, roundsRun };
}
