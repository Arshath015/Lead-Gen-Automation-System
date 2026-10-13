// Reduces already-scored evidence to a size the Groq prompt can safely fit
// within, without touching evidence scoring or the research strategy at
// all. This exists because `includeRawContent: true` (added to fetch full
// page text so evidence scoring could actually see a name mention that a
// provider's summarized extract might have cut off) had an unbudgeted
// downstream cost: a handful of full-page raw_content results, concatenated
// into the Groq prompt, pushed a single request to ~51,000 tokens against
// an 8,000-token-per-minute limit. Scoring (researchEvidence.ts/
// researchLoop.ts) still runs on the full, untruncated content — this only
// applies to the separate copy of the evidence handed to the LLM prompt.
//
// Pure and deterministic (no network, no dependency on Groq) so the actual
// size-reduction behavior is fully unit-testable.

import type { ScoredEvidenceResult } from "./researchEvidence";

export const MAX_CONTENT_CHARS_PER_ITEM = 700;
export const MAX_TOTAL_EVIDENCE_CHARS = 8000;

// A reserved floor, taken off the top of the total budget before the
// tier-priority fill below runs, guaranteeing company-generic evidence is
// never trimmed all the way to zero just because person evidence happens to
// be abundant (e.g. several includeRawContent: true full pages across the
// person-focused queries can easily total more than 8,000 chars on their
// own). ~2 items at the per-item cap — enough for the model to actually have
// independent company sources to draw on, mirroring COMPANY_THRESHOLD (2) in
// researchEvidence.ts. Company-generic evidence is still the first thing cut
// BEYOND this floor (see `tier` below) — this only stops it being cut to
// nothing.
export const MIN_COMPANY_EVIDENCE_CHARS = 1500;

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}…`;
}

// 0 = evidence that actually contributed to the person score (a genuine
// name+company co-mention, or a person-identity hit that named the person) —
// this is exactly the evidence the whole pipeline exists to find, and must
// survive trimming before anything else. 1 = other person-purpose evidence
// that didn't end up qualifying (still more useful than plain company
// facts, e.g. it explains a near-miss). 2 = company-generic evidence, the
// most replaceable tier — there's usually redundant coverage of a real
// company's basic facts, so this is what gets cut first when something has
// to give.
function tier(e: ScoredEvidenceResult): 0 | 1 | 2 {
  if (e.purpose === "person-at-company" && e.mentionsPerson && e.mentionsCompany) return 0;
  if (e.purpose === "person-identity" && e.mentionsPerson) return 0;
  if (e.purpose === "person-at-company" || e.purpose === "person-identity") return 1;
  return 2;
}

export interface EvidenceBudgetOptions {
  maxContentCharsPerItem?: number;
  maxTotalEvidenceChars?: number;
}

// Truncates every item's content to a per-item cap, then greedily keeps
// items in priority order (tier, then original order — which already
// reflects the loop's strongest/most-independent-strategy-first ordering)
// until the total character budget would be exceeded. Always keeps at least
// one item (the single highest-priority one) even if it alone were somehow
// over budget, rather than ever handing Groq zero evidence.
export function budgetEvidenceForPrompt(
  evidence: ScoredEvidenceResult[],
  options: EvidenceBudgetOptions = {}
): ScoredEvidenceResult[] {
  const maxContentCharsPerItem = options.maxContentCharsPerItem ?? MAX_CONTENT_CHARS_PER_ITEM;
  const maxTotalEvidenceChars = options.maxTotalEvidenceChars ?? MAX_TOTAL_EVIDENCE_CHARS;

  const truncated = evidence.map((e) => ({ ...e, content: truncateContent(e.content, maxContentCharsPerItem) }));

  // Stable sort by tier only — items already deduped by content fingerprint
  // upstream (researchEvidence.ts), so preserving relative order within a
  // tier keeps whatever source diversity the underlying queries produced
  // rather than imposing a second, unrelated ordering on top.
  const prioritized = truncated
    .map((e, originalIndex) => ({ e, originalIndex }))
    .sort((a, b) => tier(a.e) - tier(b.e) || a.originalIndex - b.originalIndex)
    .map(({ e }) => e);

  const companyItems = prioritized.filter((e) => tier(e) === 2);
  const nonCompanyItems = prioritized.filter((e) => tier(e) !== 2);

  // Reserve the floor FIRST, before tier 0/1 gets any say over the budget —
  // otherwise an abundance of person evidence alone (tier 0/1 fill running
  // first and simply consuming the entire budget) could leave company
  // evidence with literally nothing, which is exactly the regression this
  // guards against.
  const companyKept: ScoredEvidenceResult[] = [];
  let companyChars = 0;
  const reserve = Math.min(MIN_COMPANY_EVIDENCE_CHARS, maxTotalEvidenceChars);
  for (const e of companyItems) {
    if (companyKept.length > 0 && companyChars + e.content.length > reserve) continue;
    companyKept.push(e);
    companyChars += e.content.length;
  }

  const kept: ScoredEvidenceResult[] = [];
  let totalChars = companyChars;
  for (const e of nonCompanyItems) {
    if (kept.length > 0 && totalChars + e.content.length > maxTotalEvidenceChars) continue;
    kept.push(e);
    totalChars += e.content.length;
  }

  // Backfill: whatever budget tier 0/1 didn't need goes to more company
  // evidence, up to the same overall ceiling — the reserve only guarantees a
  // floor, it doesn't cap company evidence below what the full budget can
  // actually fit when person evidence is sparse.
  for (const e of companyItems.slice(companyKept.length)) {
    if (totalChars + e.content.length > maxTotalEvidenceChars) continue;
    companyKept.push(e);
    totalChars += e.content.length;
  }

  return [...kept, ...companyKept];
}
