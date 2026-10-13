import { env } from "../config/env";
import type { ISearchAdapter, SearchOptions, SearchResultItem } from "./ISearchAdapter";

const SEARCH_URL = "https://api.tavily.com/search";

export const tavilyAdapter: ISearchAdapter = {
  name: "tavily",

  async search(query, maxResults = 5, options: SearchOptions = {}): Promise<SearchResultItem[]> {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.tavilyApiKey,
        query,
        max_results: maxResults,
        search_depth: options.searchDepth ?? "basic",
        include_answer: false,
        ...(options.includeDomains && options.includeDomains.length > 0 ? { include_domains: options.includeDomains } : {}),
        ...(options.includeRawContent ? { include_raw_content: true } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const results: any[] = data.results ?? [];
    return results.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      // Prefer the full raw page text when we asked for it and Tavily
      // actually returned one — that's the whole point of requesting it;
      // fall back to the summarized extract otherwise.
      content: (options.includeRawContent ? r.raw_content : undefined) ?? r.content ?? "",
      publishedDate: r.published_date ?? null,
    }));
  },
};
