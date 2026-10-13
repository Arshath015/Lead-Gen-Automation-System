interface SearchResult {
  fetched: number;
  inserted: number;
  skippedDuplicates: number;
  totalAvailable: number;
  keywordDropped?: boolean;
}

interface ToastSpec {
  variant: "success" | "info" | "error";
  title: string;
  description?: string;
}

// Apollo's ranking for a given filter set isn't guaranteed stable across
// calls, so the server already retries across several pages (see
// search.routes.ts) before ever reporting 0 new leads — by the time we see
// inserted === 0 here, that retry has already happened. Collapsing that into
// a generic "Added 0 leads" message is what makes a real failure
// indistinguishable from genuine pool exhaustion, so we describe each case
// explicitly instead, using totalAvailable vs fetched to tell "pool actually
// exhausted" apart from "checked a lot, still unlucky — worth retrying".
export function describeSearchResult(result: SearchResult): ToastSpec {
  const { fetched, inserted, skippedDuplicates, totalAvailable, keywordDropped } = result;
  const keywordNote = keywordDropped
    ? " Your keyword didn't match anything in Apollo verbatim, so it was dropped for this search — results are based on the other filters."
    : "";

  if (fetched === 0) {
    return {
      variant: "info",
      title: "Apollo returned 0 results",
      description:
        totalAvailable > 0
          ? `Apollo reports ${totalAvailable} total matches but returned none on this page — try again or adjust filters.`
          : "No leads in Apollo match this profile's criteria." + keywordNote,
    };
  }

  if (inserted === 0) {
    const poolExhausted = totalAvailable === 0 || fetched >= totalAvailable;
    return {
      variant: "info",
      title: `All ${fetched} results already in your leads list`,
      description:
        (poolExhausted
          ? "Every matching lead Apollo has for this profile is already saved."
          : `Apollo reports ${totalAvailable} total matches; none of the ones checked this time were new. Try again — most of the pool is still unexplored.`) +
        keywordNote,
    };
  }

  return {
    variant: "success",
    title: `Added ${inserted} new lead${inserted === 1 ? "" : "s"}`,
    description:
      (skippedDuplicates > 0
        ? `${fetched} fetched, ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"} skipped`
        : `${fetched} fetched from Apollo`) + keywordNote,
  };
}
