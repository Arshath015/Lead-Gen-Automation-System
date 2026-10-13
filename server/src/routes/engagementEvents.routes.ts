import { Router } from "express";
import { engagementEventsRepository } from "../db/engagementEventsRepository";

export const engagementEventsRouter = Router();

// Same batched-by-leadIds shape as /api/research and /api/email-drafts, so
// the Lead Detail Tracking tab (and anything else scoped to a set of leads)
// can fetch alongside those with the existing Promise.all pattern.
engagementEventsRouter.get("/", async (req, res) => {
  const leadIds = String(req.query.leadIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (leadIds.length === 0) return res.json([]);
  const events = await engagementEventsRepository.listByLeadIds(leadIds);
  res.json(events);
});
