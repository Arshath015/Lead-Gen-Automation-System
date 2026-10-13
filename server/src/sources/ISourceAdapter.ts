import type { IcpFilters } from "../types/icp";
import type { NewLead } from "../types/lead";

export interface RawSearchResult {
  sourceId: string;
  raw: unknown;
}

export interface SearchPage {
  results: RawSearchResult[];
  totalAvailable: number;
  page: number;
  perPage: number;
  // True when the adapter automatically dropped a keyword filter that matched
  // nothing and retried without it, so the caller can tell the user their
  // keyword wasn't the reason for a broader/different result set.
  keywordDropped?: boolean;
}

// What a connector can actually do — not every future source will support
// both operations (e.g. a source that only ever supplies pre-revealed
// contacts has no reveal step at all). Purely declarative for now: the one
// real connector (Apollo) implements both `search` and `revealContact`
// unconditionally, so nothing yet branches on this at runtime. It exists so
// the registry/UI can describe what a connector offers without every caller
// having to know Apollo specifically supports both.
export type SourceCapability = "search" | "revealContact";

// Common interface every lead source (Apollo, Clay, Apify, Sales Navigator...) implements.
export interface ISourceAdapter {
  readonly name: string;
  readonly capabilities: readonly SourceCapability[];
  // Self-reports whether this connector's own credentials/config are present,
  // independent of whether the module is even allowed to load — Apollo's key
  // is `required()` at server startup (fails fast, unchanged), but a future
  // connector that isn't required to boot the server needs a way to say "I'm
  // registered but not usable yet" rather than throwing the moment anything
  // touches it.
  isConfigured(): boolean;
  search(filters: IcpFilters, page: number, perPage: number): Promise<SearchPage>;
  revealContact(sourceId: string): Promise<{
    email: string | null;
    fullName: string | null;
    linkedinUrl: string | null;
    raw: unknown;
  }>;
  // Converts one raw search result from this source's own payload shape into
  // the app's canonical NewLead — kept on the adapter itself (rather than a
  // free function callers must know to pick by source name) so search.routes.ts
  // never needs a per-source branch to normalize a result.
  normalize(result: RawSearchResult, icpProfileId: string, searchRunId: string): NewLead;
}
