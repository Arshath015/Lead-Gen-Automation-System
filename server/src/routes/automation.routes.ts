import { Router } from "express";
import { automationSettingsRepository } from "../db/automationSettingsRepository";
import { followUpTasksRepository } from "../db/followUpTasksRepository";
import { followUpMessagesRepository } from "../db/followUpMessagesRepository";
import { leadsRepository } from "../db/leadsRepository";
import { emailDraftsRepository } from "../db/emailDraftsRepository";
import { sanitizeSignatureHtml } from "../email/sanitizeHtml";
import { sendFollowUp } from "../services/followUpPipeline";
import { computeFollowUpDueReason, type FollowUpDueStatus } from "../automation/followUpEligibility";

export const automationRouter = Router();

automationRouter.get("/settings", async (_req, res) => {
  res.json(await automationSettingsRepository.get());
});

automationRouter.put("/settings", async (req, res) => {
  const patch = { ...(req.body ?? {}) };
  // Sanitized on the way in — this HTML is later embedded verbatim into
  // real outgoing emails and re-rendered in our own app, so it's never
  // trusted just because it came from our own editor.
  if (typeof patch.emailSignature === "string") {
    patch.emailSignature = sanitizeSignatureHtml(patch.emailSignature);
  }
  const updated = await automationSettingsRepository.update(patch);
  res.json(updated);
});

// dueStatus explains *why* this lead's next automatic follow-up hasn't gone
// out yet (paused / outside sending window / quota reached / disabled /
// ready), computed via the exact same gates the scheduler itself evaluates
// (see automation/followUpEligibility.ts) — so the reason shown in the UI
// can never drift from what the scheduler is actually doing. Only
// meaningful while the lead is still "active" (the same condition under
// which the UI walks the follow-up sequence at all); null otherwise.
automationRouter.get("/follow-ups/:leadId", async (req, res) => {
  const [tasks, messages, lead, settings] = await Promise.all([
    followUpTasksRepository.listByLeadId(req.params.leadId),
    followUpMessagesRepository.listByLeadId(req.params.leadId),
    leadsRepository.getById(req.params.leadId),
    automationSettingsRepository.get(),
  ]);

  let dueStatus: FollowUpDueStatus | null = null;
  if (lead && lead.engagementStatus === "active") {
    const [allDrafts, allFollowUps] = await Promise.all([emailDraftsRepository.listAll(), followUpMessagesRepository.listAll()]);
    dueStatus = computeFollowUpDueReason(lead, settings, allDrafts, allFollowUps, new Date());
  }

  res.json({ tasks, messages, dueStatus });
});

// Manually fires the lead's next pending follow-up immediately instead of
// waiting for it to become due. Runs through the exact same sendFollowUp
// path the scheduler uses, so the task is marked sent/failed the same way
// and can never later be picked up again by listPendingDue — no separate
// "cancel the schedule" step is needed, the task's own status transition
// (pending -> sending -> sent) is what prevents a duplicate.
automationRouter.post("/follow-ups/:leadId/send-now", async (req, res) => {
  const lead = await leadsRepository.getById(req.params.leadId);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!lead.email) return res.status(400).json({ error: "Lead has no revealed email address" });
  // A manual trigger is an explicit human action, so it isn't gated by the
  // global auto-follow-up toggle — but it must never override the one
  // safety rule that always applies regardless of who initiates a send.
  if (lead.engagementStatus !== "active") {
    return res.status(400).json({ error: `Cannot send a follow-up: lead is ${lead.engagementStatus}, not active` });
  }

  const tasks = await followUpTasksRepository.listByLeadId(req.params.leadId);
  const nextPending = tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)[0];
  if (!nextPending) {
    return res.status(400).json({ error: "No pending follow-up to send for this lead" });
  }

  const settings = await automationSettingsRepository.get();
  await sendFollowUp(lead, nextPending, settings);

  const [updatedTasks, updatedMessages] = await Promise.all([
    followUpTasksRepository.listByLeadId(req.params.leadId),
    followUpMessagesRepository.listByLeadId(req.params.leadId),
  ]);
  const sentTask = updatedTasks.find((t) => t.id === nextPending.id);
  if (sentTask?.status === "failed") {
    return res.status(502).json({ error: sentTask.error ?? "Follow-up send failed", tasks: updatedTasks, messages: updatedMessages });
  }
  res.json({ tasks: updatedTasks, messages: updatedMessages });
});
