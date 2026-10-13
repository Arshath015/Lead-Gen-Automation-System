import { Router } from "express";
import { emailDraftsRepository } from "../db/emailDraftsRepository";
import { followUpMessagesRepository } from "../db/followUpMessagesRepository";
import { engagementEventsRepository } from "../db/engagementEventsRepository";
import type { EngagementEvent, EngagementEventType } from "../types/engagement";

export const analyticsRouter = Router();

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

// Rates that are inherently per-email (did this specific sent message get
// delivered/opened/clicked?) are deduplicated by Resend's email id, so a
// recipient opening the same email five times still counts once. Bounce/
// complaint/reply are effectively lead-level outcomes (a lead bounces or
// unsubscribes once), so those dedupe by lead instead.
function distinctEmailIds(events: EngagementEvent[], type: EngagementEventType): number {
  return new Set(events.filter((e) => e.type === type && e.emailId).map((e) => e.emailId)).size;
}
function distinctLeads(events: EngagementEvent[], type: EngagementEventType): number {
  return new Set(events.filter((e) => e.type === type && e.leadId).map((e) => e.leadId)).size;
}

// Aggregate engagement metrics, scoped to an explicit leadIds set so the
// dashboard can apply the same date-range scoping it already uses for every
// other KPI (filtering the lead list, then passing those ids through) rather
// than this endpoint inventing its own independent range logic. Entirely
// driven by real webhook-derived engagementEvents plus our own send records
// (emailDrafts/followUpMessages) — never by the manually-editable
// Lead.engagementStatus field — so these numbers can't be skewed by a human
// overriding a lead's status.
analyticsRouter.get("/engagement-summary", async (req, res) => {
  const leadIds = String(req.query.leadIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (leadIds.length === 0) {
    return res.json({
      sentCount: 0,
      deliveredCount: 0,
      openedCount: 0,
      clickedCount: 0,
      bouncedCount: 0,
      complainedCount: 0,
      repliedCount: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
      replyRate: 0,
      bounceRate: 0,
      complaintRate: 0,
    });
  }

  const idSet = new Set(leadIds);
  const [drafts, allMessages, events] = await Promise.all([
    emailDraftsRepository.getByLeadIds(leadIds),
    followUpMessagesRepository.listAll(),
    engagementEventsRepository.listByLeadIds(leadIds),
  ]);
  const messages = allMessages.filter((m) => idSet.has(m.leadId));

  const sentCount = drafts.filter((d) => d.sendStatus === "sent").length + messages.length;
  const deliveredCount = distinctEmailIds(events, "delivered");
  const openedCount = distinctEmailIds(events, "opened");
  const clickedCount = distinctEmailIds(events, "clicked");
  const bouncedCount = distinctLeads(events, "bounced");
  const complainedCount = distinctLeads(events, "complained");
  const repliedCount = distinctLeads(events, "received");

  res.json({
    sentCount,
    deliveredCount,
    openedCount,
    clickedCount,
    bouncedCount,
    complainedCount,
    repliedCount,
    deliveryRate: pct(deliveredCount, sentCount),
    openRate: pct(openedCount, sentCount),
    clickRate: pct(clickedCount, sentCount),
    replyRate: pct(repliedCount, sentCount),
    bounceRate: pct(bouncedCount, sentCount),
    complaintRate: pct(complainedCount, sentCount),
  });
});
