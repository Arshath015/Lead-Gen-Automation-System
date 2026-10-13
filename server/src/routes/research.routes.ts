import { Router } from "express";
import { leadsRepository } from "../db/leadsRepository";
import { researchBriefsRepository } from "../db/researchBriefsRepository";
import { leadActivityRepository } from "../db/leadActivityRepository";
import { tavilyAdapter } from "../search/tavilyAdapter";
import { groqAdapter } from "../llm/groqAdapter";
import { buildResearchStrategyList } from "../services/researchIdentity";
import { runResearchLoop } from "../services/researchLoop";
import { applyConfidenceSafeguards } from "../services/researchEvidence";
import type { ResearchBrief } from "../types/research";

export const researchRouter = Router();

async function markFailed(leadId: string, force: boolean, message: string): Promise<void> {
  await researchBriefsRepository
    .upsert(
      leadId,
      {
        status: "failed",
        companyOverview: null,
        recentNews: [],
        painPoints: [],
        sources: [],
        rawSearchResults: null,
        rawLlmResponse: null,
        model: null,
        editedByUser: false,
        error: message,
      },
      { force }
    )
    .catch(() => undefined);
  await leadActivityRepository.record(leadId, "research_failed", `Research failed: ${message}`);
}

async function generateForLead(leadId: string, force: boolean): Promise<ResearchBrief> {
  const lead = await leadsRepository.getById(leadId);
  if (!lead) throw new Error("Lead not found");

  // Degenerate case: no name, no company, no LinkedIn — there is nothing
  // reliable to even attempt. Distinct from "attempted but inconclusive"
  // below, which is a normal completed brief, not a failure.
  if (buildResearchStrategyList(lead).length === 0) {
    const message = "Insufficient identity information to research this lead: no usable name, company, or LinkedIn profile on file.";
    await markFailed(leadId, force, message);
    throw new Error(message);
  }

  let loopResult: Awaited<ReturnType<typeof runResearchLoop>>;
  try {
    loopResult = await runResearchLoop(lead, (query, maxResults, options) => tavilyAdapter.search(query, maxResults, options));
  } catch (err) {
    await markFailed(leadId, force, (err as Error).message);
    throw err;
  }

  try {
    const generated = await groqAdapter.generateResearchBrief(lead, loopResult.evidence, loopResult.confidence);
    const safeguarded = applyConfidenceSafeguards(generated, loopResult.confidence);
    const brief = await researchBriefsRepository.upsert(
      leadId,
      {
        status: "complete",
        companyOverview: safeguarded.companyOverview,
        recentNews: safeguarded.recentNews,
        painPoints: safeguarded.painPoints,
        sources: safeguarded.sources,
        rawSearchResults: loopResult.evidence,
        rawLlmResponse: safeguarded.raw,
        model: safeguarded.model,
        editedByUser: false,
        error: null,
      },
      { force }
    );
    await leadActivityRepository.record(
      leadId,
      "research_completed",
      loopResult.confidence.person.verified
        ? "Research brief generated"
        : "Research brief generated (person/company association unverified — see brief)"
    );
    return brief;
  } catch (err) {
    await markFailed(leadId, force, (err as Error).message);
    throw err;
  }
}

researchRouter.get("/", async (req, res) => {
  const leadIds = String(req.query.leadIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (leadIds.length === 0) return res.json([]);
  const briefs = await researchBriefsRepository.getByLeadIds(leadIds);
  res.json(briefs);
});

researchRouter.get("/:leadId", async (req, res) => {
  const brief = await researchBriefsRepository.getByLeadId(req.params.leadId);
  if (!brief) return res.status(404).json({ error: "Not found" });
  res.json(brief);
});

researchRouter.patch("/:leadId", async (req, res) => {
  const updated = await researchBriefsRepository.update(req.params.leadId, {
    ...(req.body ?? {}),
    editedByUser: true,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

researchRouter.post("/:leadId/generate", async (req, res) => {
  const force = Boolean(req.body?.force);
  try {
    const brief = await generateForLead(req.params.leadId, force);
    res.json(brief);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

researchRouter.post("/generate-bulk", async (req, res) => {
  const { leadIds, force } = req.body ?? {};
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: "leadIds[] is required" });
  }

  const results: { leadId: string; brief?: ResearchBrief; error?: string }[] = [];
  for (const leadId of leadIds) {
    try {
      const brief = await generateForLead(leadId, Boolean(force));
      results.push({ leadId, brief });
    } catch (err) {
      results.push({ leadId, error: (err as Error).message });
    }
  }

  res.json({ results });
});
