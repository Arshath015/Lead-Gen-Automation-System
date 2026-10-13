import { randomUUID } from "node:crypto";
import { Router } from "express";
import { icpRepository } from "../db/icpRepository";
import { leadsRepository } from "../db/leadsRepository";
import { getSourceAdapter } from "../sources/registry";
import type { Lead } from "../types/lead";

export const searchRouter = Router();

// Safety cap on how many extra Apollo pages a single "Find leads" click will
// walk through. Apollo's ranking for a given filter set is not guaranteed
// stable across calls — confirmed empirically: two back-to-back identical
// requests (same filters, same page, same per_page, seconds apart) returned
// different people in a different order. So a single computed "next page"
// can come back entirely duplicate even when the underlying pool
// (total_entries) is nowhere near exhausted. Rather than stopping at the
// first page and reporting "0 new", keep advancing until enough new unique
// leads are found, the pool is genuinely exhausted, or this cap is hit.
const MAX_SEARCH_ATTEMPTS = 8;

searchRouter.post("/", async (req, res) => {
  const { icpProfileId, page, perPage = 25, source = "apollo" } = req.body ?? {};

  if (!icpProfileId) {
    return res.status(400).json({ error: "icpProfileId is required" });
  }
  const adapter = getSourceAdapter(source);
  if (!adapter) {
    return res.status(400).json({ error: `Unknown source: ${source}` });
  }

  const icp = await icpRepository.getById(icpProfileId);
  if (!icp) return res.status(404).json({ error: "ICP profile not found" });

  try {
    const searchRunId = randomUUID();
    // When the caller doesn't pin a specific page, start from a guess based
    // on however many leads this profile has already pulled — a reasonable
    // starting point, but not load-bearing: the loop below compensates if
    // Apollo's ordering has shifted since the last search.
    let currentPage = page;
    if (currentPage === undefined) {
      const alreadyFound = await leadsRepository.list({ icpProfileId: icp.id });
      currentPage = Math.floor(alreadyFound.length / perPage) + 1;
    }
    const startingPage = currentPage;

    let totalAvailable = 0;
    let totalFetched = 0;
    let totalSkipped = 0;
    let keywordDropped = false;
    let allInserted: Lead[] = [];
    let attempts = 0;

    while (attempts < MAX_SEARCH_ATTEMPTS) {
      attempts += 1;
      const pageResult = await adapter.search(icp.filters, currentPage, perPage);
      totalAvailable = pageResult.totalAvailable;
      keywordDropped = keywordDropped || (pageResult.keywordDropped ?? false);
      totalFetched += pageResult.results.length;

      const newLeads = pageResult.results.map((r) => adapter.normalize(r, icp.id, searchRunId));
      const { inserted, skippedDuplicates } = await leadsRepository.bulkCreate(newLeads);
      allInserted = allInserted.concat(inserted);
      totalSkipped += skippedDuplicates;

      const poolExhausted = pageResult.results.length === 0 || currentPage * perPage >= totalAvailable;
      if (allInserted.length >= perPage || poolExhausted) break;
      currentPage += 1;
    }

    res.json({
      searchRunId,
      totalAvailable,
      page: startingPage,
      perPage,
      fetched: totalFetched,
      inserted: allInserted.length,
      skippedDuplicates: totalSkipped,
      keywordDropped,
      leads: allInserted,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
