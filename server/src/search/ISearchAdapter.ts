export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  publishedDate: string | null;
}

export interface SearchOptions {
  // Restricts results to these domains — e.g. ["linkedin.com"] to replicate a
  // Google "site:" search, or a company's own verified domain once
  // discovered. Providers that don't support server-side domain restriction
  // may ignore this; callers should not assume it's always honored.
  includeDomains?: string[];
  // Requests full page text instead of a provider-summarized extract, when
  // supported — identity-critical queries need this because a name mention
  // further down a page than the default extract covers is otherwise
  // invisible to our own evidence scoring, not because the source wasn't
  // actually relevant.
  includeRawContent?: boolean;
  // "advanced" trades cost/latency for more thorough crawling/ranking.
  // Reserve for the highest-priority identity query per lead, not every one.
  searchDepth?: "basic" | "advanced";
}

// Common interface for web-search providers used to gather research context.
export interface ISearchAdapter {
  readonly name: string;
  search(query: string, maxResults?: number, options?: SearchOptions): Promise<SearchResultItem[]>;
}
