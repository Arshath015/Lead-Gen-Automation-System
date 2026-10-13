// Deterministic, provider-agnostic identity assessment and query planning for
// the research pipeline. Pure functions only (no network calls) so this is
// fully unit-testable independent of Tavily/Groq — the caller (research.routes.ts)
// is responsible for actually running these queries against a search provider.
//
// The problem this exists to fix: a lead with only a company name (common for
// manually-created leads) used to produce exactly one generic query
// ("{company} company overview recent news"), whose top results were treated
// as relevant regardless of whether they were actually about the right
// organization, and regardless of whether any of it had anything to do with
// the specific person being researched. For a common company name ("Apex",
// "Summit", "Solutions Group") that silently attaches a stranger's company to
// this lead. This module instead inspects every identity signal actually
// available on the lead, decides how much they corroborate each other, and
// builds a small set of targeted, purpose-tagged queries — so callers know
// which evidence is about the person specifically vs. the company in
// general, and how much to trust each result.

export interface LeadIdentityInput {
  fullName: string;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  email: string | null;
  linkedinUrl: string | null;
  location: string | null;
}

// "confirms": the email domain matches the company (by stored companyDomain
// or by name overlap) — strong corroborating identity evidence.
// "mismatch": there IS a company to compare against, and the domain clearly
// doesn't relate to it — a contradiction, not just an absence of evidence.
// "personal-provider": a consumer webmail domain (gmail.com, etc.) — tells us
// nothing about company affiliation either way, and must never be read as
// either confirming or contradicting it.
// "none": no email, or no company/domain to compare it against at all.
export type EmailDomainEvidence = "confirms" | "mismatch" | "personal-provider" | "none";

export type QueryPurpose = "person-identity" | "person-at-company" | "company-generic";
export type EvidenceStrength = "strong" | "medium" | "weak";

export interface ResearchQuerySearchOptions {
  includeDomains?: string[];
  includeRawContent?: boolean;
  searchDepth?: "basic" | "advanced";
}

export interface ResearchQuery {
  query: string;
  purpose: QueryPurpose;
  strength: EvidenceStrength;
  // Passed through to the search provider (see ISearchAdapter.SearchOptions)
  // when it's supported. Absent entirely for queries that don't need it
  // (e.g. plain company-generic lookups), rather than an empty object.
  searchOptions?: ResearchQuerySearchOptions;
}


const FREE_EMAIL_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "rediffmail.com",
  "zoho.com",
]);

// Stripped from a company name before comparing it to an email domain label —
// legal-entity/generic suffixes that carry no identifying signal ("Acme
// Inc" and "acme.com" should match on "acme", not fail because of "inc").
const COMPANY_SUFFIX_WORDS = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "group",
  "holdings",
  "technologies",
  "tech",
  "solutions",
  "systems",
  "international",
  "global",
  "enterprises",
  "partners",
  "ventures",
]);

// Generic/common business words that, alone or in combination, make a
// company name unreliable as a sole search key — many unrelated companies
// share names built entirely from these. Not exhaustive by design (this is a
// conservative, explicit, reviewable list, same philosophy as geoLookup.ts's
// proxy-signature list) — a name not on this list is simply not flagged, not
// proof it's unique.
const COMMON_GENERIC_COMPANY_WORDS = new Set([
  "global",
  "solutions",
  "group",
  "partners",
  "ventures",
  "capital",
  "holdings",
  "enterprises",
  "consulting",
  "services",
  "systems",
  "technologies",
  "international",
  "summit",
  "apex",
  "prime",
  "elite",
  "premier",
  "national",
  "united",
  "allied",
  "pinnacle",
  "vertex",
  "nexus",
  "core",
  "digital",
  "dynamics",
  "innovations",
  "ventures",
]);

// Used only for comparing a company name to an email/domain label — legal-
// entity suffixes ("Inc", "Solutions", "Group", ...) never appear in a real
// domain, so stripping them avoids a false non-match (e.g. "Acme Solutions"
// vs. "acme.com"). Deliberately NOT used for commonality detection below —
// several of these same words (e.g. "solutions", "global", "group") are
// exactly what makes a name generic in the first place, so stripping them
// there would (and once did) hide the very signal being checked for.
function domainComparableTokens(company: string): string[] {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !COMPANY_SUFFIX_WORDS.has(w));
}

function tokenizeCompanyName(company: string): string[] {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

// A single generic word ("Apex"), a very short acronym ("ABC"), or a name
// built entirely from generic business words ("Global Solutions") is judged
// common — real, but not safely unique enough to search on alone with
// confidence that the top result is the right organization.
export function isCommonCompanyName(company: string): boolean {
  const tokens = tokenizeCompanyName(company);
  if (tokens.length === 0) return false;
  if (tokens.length === 1 && (tokens[0].length <= 3 || COMMON_GENERIC_COMPANY_WORDS.has(tokens[0]))) return true;
  return tokens.every((t) => COMMON_GENERIC_COMPANY_WORDS.has(t));
}

// Takes a bare domain or a full URL and returns its main registrable label
// (e.g. "acme.co.uk" / "https://acme.co.uk/about" -> "acme").
function domainLabel(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const parts = cleaned.split(".").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts[parts.length - 2];
}

// Shared by assessEmailDomain (below) and researchLoop.ts's adaptive
// domain-discovery step: does this domain's label plausibly correspond to
// this company's name? Extracted so both call sites use the exact same
// notion of "matches" rather than two independently-drifting heuristics.
//
// Requires the shorter side of the comparison to be at least 4 characters —
// a bare substring check with no length floor would call almost any short
// domain label (e.g. a 1-2 letter aggregator subdomain, or coincidentally
// "a.com"/"b.com") a "match" simply because most company names contain that
// letter somewhere. Real company domain labels are essentially never this
// short, so this costs nothing on genuine matches while ruling out the
// false-positive case that would otherwise make the adaptive-discovery step
// (researchLoop.ts) chase an unrelated third-party/aggregator domain.
export function domainLabelMatchesCompany(domain: string, company: string): boolean {
  const label = domainLabel(domain);
  const companyJoined = domainComparableTokens(company).join("");
  if (!label || !companyJoined) return false;
  if (Math.min(label.length, companyJoined.length) < 4) return label === companyJoined;
  return companyJoined.includes(label) || label.includes(companyJoined);
}

export function assessEmailDomain(
  email: string | null,
  company: string | null,
  companyDomain: string | null
): EmailDomainEvidence {
  if (!email || !email.includes("@")) return "none";
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return "none";
  if (FREE_EMAIL_PROVIDERS.has(domain)) return "personal-provider";

  const emailLabel = domainLabel(domain);

  if (companyDomain) {
    const storedLabel = domainLabel(companyDomain);
    if (storedLabel && emailLabel === storedLabel) return "confirms";
    // A companyDomain IS on file and doesn't match — that's a real
    // contradiction, regardless of what the free-text company name says.
    if (storedLabel) return "mismatch";
  }

  if (!company) return "none"; // nothing to compare the domain against at all
  if (!emailLabel) return "none";
  return domainLabelMatchesCompany(domain, company) ? "confirms" : "mismatch";
}

// A title token too short or too generic to usefully constrain a quoted,
// boolean-style search ("AI", "VP", "PM") adds noise rather than precision —
// unlike isCommonCompanyName, this doesn't affect confidence scoring, only
// whether the title is worth including as an exact-phrase term at all.
const GENERIC_TITLE_WORDS = new Set(["ai", "vp", "ceo", "cto", "coo", "cfo", "hr", "pm", "qa", "ux", "it", "dev", "eng", "lead", "staff", "manager"]);
export function isTitleTooGenericToQuote(title: string): boolean {
  const t = title.trim().toLowerCase();
  return t.length <= 3 || GENERIC_TITLE_WORDS.has(t);
}

const STRENGTH_RANK: Record<EvidenceStrength, number> = { strong: 3, medium: 2, weak: 1 };

// Signals about a lead reused by both strategy-list construction and, later,
// evidence scoring — computed once so the two never quietly disagree about,
// say, whether the email domain matches.
export interface IdentitySignals {
  hasPerson: boolean;
  hasCompany: boolean;
  hasLinkedin: boolean;
  emailDomainEvidence: EmailDomainEvidence;
  companyNameIsCommon: boolean;
}

export function computeIdentitySignals(lead: LeadIdentityInput): IdentitySignals {
  const fullName = lead.fullName?.trim() ?? "";
  const hasPerson = fullName.length > 0 && fullName.toLowerCase() !== "unknown";
  const company = lead.company?.trim() || null;
  return {
    hasPerson,
    hasCompany: !!company,
    hasLinkedin: !!lead.linkedinUrl?.trim(),
    emailDomainEvidence: assessEmailDomain(lead.email, company, lead.companyDomain),
    companyNameIsCommon: company ? isCommonCompanyName(company) : false,
  };
}

// Returns the FULL ordered candidate list of search strategies for this lead
// — deterministic, no cap, no network. Strongest-evidence-first ordering is
// itself "start with the strongest available identity signals"; the caller
// (researchLoop.ts) decides how many of these to actually run, and stops
// early once enough evidence has been gathered — this function only answers
// "what could we try, and in what order," never "how much should we try."
//
// Every strategy is gated on the specific lead fields it needs, so a sparse
// lead naturally gets a short list rather than queries built from missing
// data. LinkedIn- and domain-anchored strategies rank above free-text
// company-name strategies because they're harder to accidentally collide
// with an unrelated same-named organization or person.
export function buildResearchStrategyList(lead: LeadIdentityInput): ResearchQuery[] {
  const fullName = lead.fullName?.trim() ?? "";
  const title = lead.title?.trim() || null;
  const company = lead.company?.trim() || null;
  const companyDomain = lead.companyDomain?.trim() || null;
  const signals = computeIdentitySignals(lead);
  const { hasPerson, hasCompany, hasLinkedin, emailDomainEvidence, companyNameIsCommon } = signals;
  const mismatched = emailDomainEvidence === "mismatch";
  const confirmed = emailDomainEvidence === "confirms";

  const queries: ResearchQuery[] = [];

  if (hasPerson && hasLinkedin) {
    queries.push({
      query: [fullName, title, company, "linkedin"].filter(Boolean).join(" "),
      purpose: "person-identity",
      strength: "strong",
      searchOptions: { includeDomains: ["linkedin.com"], includeRawContent: true, searchDepth: "advanced" },
    });
  }

  // Quoted, boolean-style phrasing mimics Google search-operator syntax —
  // Tavily is an AI-search backend, not a literal-phrase index, and may not
  // honor quotes as a strict exact-match filter the way Google does. Kept
  // (it's cheap and sometimes still helps), but always paired with a plain,
  // unquoted natural-language variant below rather than relied on alone.
  if (hasPerson && hasCompany && title && !isTitleTooGenericToQuote(title)) {
    queries.push({
      query: `"${fullName}" "${company}" "${title}"`,
      purpose: "person-at-company",
      strength: mismatched ? "weak" : hasLinkedin || confirmed ? "strong" : "medium",
      searchOptions: { includeRawContent: true },
    });
  }

  if (hasPerson && hasCompany) {
    queries.push({
      query: `"${fullName}" "${company}"`,
      purpose: "person-at-company",
      strength: mismatched ? "weak" : hasLinkedin || confirmed ? "strong" : "medium",
      searchOptions: { includeRawContent: true },
    });
    // Plain natural-language phrasing, tried alongside the quoted version
    // above rather than instead of it — we don't yet have evidence for
    // which phrasing Tavily's ranking actually favors, so both run as
    // independent candidates rather than gambling on one.
    queries.push({
      query: `${fullName} ${company}`,
      purpose: "person-at-company",
      strength: mismatched ? "weak" : "medium",
      searchOptions: { includeRawContent: true },
    });
    // A genuine question, not a keyword string — plays to what an
    // LLM-oriented search backend is actually built to answer well.
    queries.push({
      query: `Who is ${fullName} at ${company}?`,
      purpose: "person-identity",
      strength: "medium",
      searchOptions: { includeRawContent: true },
    });
  }

  // Anchors the person search on the verified domain instead of the
  // free-text company name — valuable especially when the company name is
  // common, since a domain can't collide the way "Apex" or "Summit" can.
  // When the email domain is mismatched, this is exactly the kind of
  // independent, domain-anchored evidence worth reaching for FIRST — it's
  // unrelated to whichever personal/alias email triggered the mismatch, so
  // it's promoted ahead of the (now-suspect) free-text company-name
  // strategies rather than downgraded alongside them.
  if (hasPerson && companyDomain) {
    queries.push({
      query: `"${fullName}" ${companyDomain}`,
      purpose: "person-at-company",
      strength: mismatched ? "strong" : "medium",
      searchOptions: { includeDomains: [companyDomain], includeRawContent: true },
    });
  }

  // Attempts to DISCOVER a LinkedIn profile (as opposed to the strategy
  // above, which uses one already on file) — weaker than a verified profile
  // URL since it's unconfirmed, but still a targeted, high-value strategy
  // worth trying before falling back to a bare company-only search. This is
  // what lets a sparse lead (name + company, no stored LinkedIn) find real
  // person evidence on a later round rather than stopping at "we don't have
  // a LinkedIn URL, so we can't try." Promoted to "strong" when the email
  // domain is mismatched — a real, independent identity source (LinkedIn)
  // is exactly what's needed to outweigh a contradicted signal, so it
  // belongs ahead of generic company evidence, not tied with it.
  //
  // Restricted to linkedin.com via includeDomains rather than hoping the
  // word "linkedin" in free text biases a general search that way — the
  // structured restriction is what a Google "site:linkedin.com" search
  // actually relies on, and it's a real Tavily API parameter, not a query
  // string convention Tavily is under no obligation to honor.
  if (hasPerson && !hasLinkedin) {
    queries.push({
      query: [fullName, company].filter(Boolean).join(" "),
      purpose: "person-identity",
      strength: mismatched ? "strong" : "medium",
      searchOptions: { includeDomains: ["linkedin.com"], includeRawContent: true },
    });
  }

  if (hasPerson && !hasCompany && title) {
    queries.push({
      query: `"${fullName}" "${title}"`,
      purpose: "person-identity",
      strength: "weak",
      searchOptions: { includeRawContent: true },
    });
  }

  if (hasPerson && !hasCompany && !title) {
    queries.push({
      query: `"${fullName}"`,
      purpose: "person-identity",
      strength: "weak",
      searchOptions: { includeRawContent: true },
    });
  }

  if (hasCompany) {
    queries.push({
      query: `${company} company overview recent news`,
      purpose: "company-generic",
      strength: companyNameIsCommon && !confirmed ? "weak" : "medium",
    });
  }

  if (companyDomain) {
    queries.push({
      query: `${companyDomain} company news`,
      purpose: "company-generic",
      strength: "medium",
    });
  }

  // Keyed on query text AND includeDomains together, not text alone — a
  // domain-restricted search and an unrestricted one can share identical
  // query text (e.g. the unquoted person+company variant and the LinkedIn-
  // discovery query both reduce to "Jane Doe Stampsize") while being
  // fundamentally different searches. Text-only dedup would silently drop
  // whichever one lost the race, even though only one is actually redundant.
  const seen = new Set<string>();
  const deduped = queries.filter((q) => {
    const key = `${q.query.toLowerCase()}|${(q.searchOptions?.includeDomains ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return interleaveByPurpose(deduped);
}

// Regression this exists to fix: a lead with several viable person-focused
// strategies (very common for any lead with a title, company, and
// companyDomain on file — easily 5-6 person candidates) used to fill the
// ENTIRE round budget (researchLoop.ts's QUERIES_PER_ROUND * MAX_ROUNDS) with
// nothing but person-purpose queries before a single company-generic query
// ever ran, since company-generic strategies never rank above "medium" and a
// flat global sort-by-strength let sheer person-candidate COUNT crowd them
// out of the budget entirely. The observable symptom: research briefs read
// as "about the person" only, with no fresh company-specific evidence at
// all, because scoreCompanyDimension (researchEvidence.ts) can only be
// satisfied by company-generic evidence in the first place.
//
// Round-robining across purposes guarantees every purpose that has
// candidates gets an early turn — strongest-first WITHIN each purpose is
// preserved, but no single purpose can monopolize every slot just because it
// has more candidates than the others.
const PURPOSE_INTERLEAVE_ORDER: QueryPurpose[] = ["person-identity", "person-at-company", "company-generic"];

function interleaveByPurpose(queries: ResearchQuery[]): ResearchQuery[] {
  const buckets = new Map<QueryPurpose, ResearchQuery[]>();
  for (const purpose of PURPOSE_INTERLEAVE_ORDER) {
    const items = queries.filter((q) => q.purpose === purpose).sort((a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength]);
    if (items.length > 0) buckets.set(purpose, items);
  }

  const ordered: ResearchQuery[] = [];
  let tookAny = true;
  while (tookAny) {
    tookAny = false;
    for (const purpose of PURPOSE_INTERLEAVE_ORDER) {
      const bucket = buckets.get(purpose);
      if (bucket && bucket.length > 0) {
        ordered.push(bucket.shift()!);
        tookAny = true;
      }
    }
  }
  return ordered;
}
