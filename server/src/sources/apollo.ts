import { env } from "../config/env";
import type { IcpFilters } from "../types/icp";
import type { NewLead } from "../types/lead";
import type { ISourceAdapter, RawSearchResult, SearchPage } from "./ISourceAdapter";
import { SourceApiError } from "./SourceApiError";
import { computeDedupKey } from "../normalize/leads";

const SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";
const MATCH_URL = "https://api.apollo.io/api/v1/people/match";

// Thrown for non-2xx Apollo responses. `code` is Apollo's own machine-readable
// error_details.code (e.g. "BILLING.LIMIT.CREDITS_EXHAUSTED") when present, so
// callers can branch on specific failure classes without re-parsing text.
// Extends the generic SourceApiError so cross-connector callers (e.g. the
// reveal-bulk credit-exhaustion check in leads.routes.ts) can react to
// `instanceof SourceApiError` without naming Apollo specifically — `.name`
// is still explicitly set to "ApolloApiError" so anything that already
// inspects that exact value (logs, error messages) is unaffected.
export class ApolloApiError extends SourceApiError {
  constructor(code: string | null, message: string) {
    super("apollo", code, message);
    this.name = "ApolloApiError";
  }
}

interface ApolloErrorDetails {
  code: string;
  message?: string;
  context?: {
    credit_type?: { value: string };
    credit_balance?: { value: number };
    next_billing_date?: { value: string };
  };
}

// Apollo's raw error bodies include HTML anchor tags and internal jargon meant
// for their own dashboard, not end users — never forward that text as-is.
// Map known error_details.code values to a clean, actionable message.
const FRIENDLY_ERRORS: Record<string, (details: ApolloErrorDetails) => string> = {
  "BILLING.LIMIT.CREDITS_EXHAUSTED": (details) => {
    const creditType = details.context?.credit_type?.value ?? "credits";
    const resetDate = details.context?.next_billing_date?.value;
    return (
      `Apollo ${creditType} exhausted. This action requires available Apollo credits. ` +
      `Upgrade your plan${resetDate ? ` or wait for your billing cycle to reset on ${resetDate}` : " or wait for your billing cycle to reset"}.`
    );
  },
};

function parseApolloError(status: number, text: string): { code: string | null; message: string } {
  try {
    const parsed = JSON.parse(text);
    const details: ApolloErrorDetails | undefined = parsed?.error_details;
    if (details?.code && FRIENDLY_ERRORS[details.code]) {
      return { code: details.code, message: FRIENDLY_ERRORS[details.code](details) };
    }
    if (details?.code) {
      return { code: details.code, message: details.message ?? `Apollo API error (${status}).` };
    }
    // Apollo's plain top-level `error` string is sometimes readable but can
    // contain embedded HTML — only surface it if it looks like plain text.
    if (typeof parsed?.error === "string" && !/[<>]/.test(parsed.error)) {
      return { code: null, message: parsed.error };
    }
  } catch {
    // Non-JSON body — fall through to the generic message below.
  }
  return { code: null, message: `Apollo API error (${status}). Please try again.` };
}

async function apolloFetch(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.apolloApiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    const { code, message } = parseApolloError(res.status, text);
    console.error(`[apollo] ${url} -> ${res.status} (${code ?? "unknown"}): ${message}`);
    throw new ApolloApiError(code, message);
  }

  return JSON.parse(text);
}

// Apollo's organization_num_employees_ranges accepts arbitrary "min,max"
// ranges — confirmed empirically against the real API (e.g. "200,500" and
// "10000,20000" both filter to meaningfully different counts; it's not
// limited to a fixed preset list). A bare single number (e.g. "200") is also
// accepted by Apollo directly and empirically behaves as an open-ended
// minimum: sending "200" alone returns the identical total_entries as an
// explicit "200,100000000" upper bound. Normalized here to "N," (min, no
// max) so the outgoing request states that intent explicitly rather than
// relying on Apollo's undocumented leniency with a malformed-looking value.
// A hyphen ("11-50") is also accepted as range shorthand — see
// IcpProfileForm.tsx, which uses hyphens for ranges precisely because commas
// are already the separator between list entries.
function normalizeEmployeeRanges(ranges: string[]): string[] {
  return ranges
    .map((r) => {
      const trimmed = r.trim();
      if (/^\d+$/.test(trimmed)) return `${trimmed},`;
      return trimmed.replace(/\s*-\s*/, ",");
    })
    .filter((r) => /^\d+\s*,\s*\d*$/.test(r));
}

// q_keywords is a single free-text phrase (Apollo matches it as one query,
// not as a set of alternative keywords) — a comma- or space-joined list of
// many distinct concepts (e.g. "GCC, Global Capability Center, ODC, shared
// services, cost reduction") reliably matches zero records. Use only the
// first clause so the search still runs on the single most important term
// instead of guaranteeing no results; the full text the user entered is left
// untouched in the stored ICP profile.
function primaryKeyword(keywords: string): string {
  return keywords.split(/[,;]/)[0].trim();
}

function buildSearchBody(filters: IcpFilters, page: number, perPage: number) {
  const body: Record<string, unknown> = {
    page,
    per_page: perPage,
  };
  if (filters.personTitles?.length) body.person_titles = filters.personTitles;
  if (filters.personLocations?.length) body.person_locations = filters.personLocations;
  if (filters.organizationLocations?.length) body.organization_locations = filters.organizationLocations;
  if (filters.organizationDomains?.length) body.q_organization_domains_list = filters.organizationDomains;
  if (filters.employeeRanges?.length) {
    const normalized = normalizeEmployeeRanges(filters.employeeRanges);
    if (normalized.length) body.organization_num_employees_ranges = normalized;
  }
  if (filters.keywords?.trim()) body.q_keywords = primaryKeyword(filters.keywords);
  return body;
}

export const apolloAdapter: ISourceAdapter = {
  name: "apollo",
  capabilities: ["search", "revealContact"],

  // Apollo's key is `required()` in env.ts, so the server never even starts
  // without it — this is technically always true once this module has
  // loaded at all. Kept as a real (not hardcoded-true) check anyway so it
  // behaves consistently with how a future, non-required connector would
  // implement the same method.
  isConfigured(): boolean {
    return !!env.apolloApiKey;
  },

  async search(filters, page, perPage): Promise<SearchPage> {
    const body = buildSearchBody(filters, page, perPage);
    let data = await apolloFetch(SEARCH_URL, body);
    let keywordDropped = false;

    // q_keywords only matches literal text — even a single well-intentioned
    // multi-word phrase ("Multinational Corporation", "existing GCC", "India
    // expansion") often doesn't occur verbatim anywhere in Apollo's index. It
    // doesn't always zero the search outright, either: one real ICP's exact
    // request returned total_entries: 1 with the keyword applied, vs 263,729
    // for the identical person/company criteria without it — a real but
    // vanishingly rare literal match masking a huge otherwise-matching pool.
    // A hard "=== 0" check misses that case entirely. If the keyword'd result
    // can't even fill a single page, treat it as an unreliably narrow filter
    // rather than the true available pool, and retry without it.
    if ((data.total_entries ?? 0) < perPage && body.q_keywords) {
      const { q_keywords: _dropped, ...withoutKeyword } = body;
      const retryData = await apolloFetch(SEARCH_URL, withoutKeyword);
      if ((retryData.total_entries ?? 0) > (data.total_entries ?? 0)) {
        data = retryData;
        keywordDropped = true;
      }
    }

    const people: any[] = data.people ?? [];
    // Apollo's mixed_people/api_search response has no `pagination` wrapper —
    // `total_entries` is a top-level field, and page/per_page are not echoed back at all.
    return {
      results: people.map((p) => ({ sourceId: p.id, raw: p })),
      totalAvailable: data.total_entries ?? people.length,
      page,
      perPage,
      keywordDropped,
    };
  },

  async revealContact(sourceId) {
    const data = await apolloFetch(MATCH_URL, {
      id: sourceId,
      reveal_personal_emails: true,
    });
    const person = data.person ?? null;
    // Unlike the search endpoint, people/match (a paid enrichment lookup) returns
    // the real, unobfuscated name and profile fields — persist them so a revealed
    // lead stops showing the search endpoint's masked "First La**t" placeholder.
    const joinedName = [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim();
    const fullName: string | null = person?.name ?? (joinedName || null);
    return {
      email: person?.email ?? null,
      fullName,
      linkedinUrl: person?.linkedin_url ?? null,
      raw: person,
    };
  },

  // Moved here verbatim from normalize/leads.ts's former normalizeApolloPerson
  // — same logic, just reachable through the adapter itself now, so
  // search.routes.ts can call `adapter.normalize(...)` generically instead of
  // importing an Apollo-named function.
  normalize(result: RawSearchResult, icpProfileId: string, searchRunId: string): NewLead {
    const p = result.raw as any;
    const fullName = [p.first_name, p.last_name ?? p.last_name_obfuscated].filter(Boolean).join(" ").trim() || "Unknown";
    const companyDomain: string | null = p.organization?.primary_domain ?? p.organization?.website_url ?? null;
    const email: string | null = p.email ?? null;

    return {
      source: "apollo",
      sourceId: result.sourceId,
      dedupKey: computeDedupKey({ source: "apollo", sourceId: result.sourceId, email, companyDomain, fullName }),
      email,
      fullName,
      title: p.title ?? null,
      company: p.organization?.name ?? null,
      companyDomain,
      linkedinUrl: p.linkedin_url ?? null,
      phone: null,
      location: [p.city, p.state, p.country].filter(Boolean).join(", ") || null,
      icpProfileId,
      searchRunId,
      raw: p,
      roleCategory: null,
      industry: null,
      sourceFile: null,
      sourceWorksheet: null,
    };
  },
};
