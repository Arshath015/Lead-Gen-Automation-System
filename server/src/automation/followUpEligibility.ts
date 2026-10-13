import type { EmailAutomationSettings } from "../types/automation";
import type { Lead } from "../types/lead";
import type { EmailDraft } from "../types/email";
import type { FollowUpMessage } from "../types/automation";

// Shared with scheduler.ts (the only two callers) so the "is this lead
// eligible for automation right now" and "are we inside the sending window"
// checks can never drift between what the scheduler actually does and what
// the UI reports as the reason a due follow-up hasn't gone out yet.
export function isWithinSendingWindow(settings: EmailAutomationSettings, now: Date): boolean {
  if (!settings.sendingDays.includes(now.getDay())) return false;
  const hour = now.getHours();
  return hour >= settings.sendingHourStart && hour < settings.sendingHourEnd;
}

export function isEligible(lead: Lead): boolean {
  return lead.engagementStatus === "active" && lead.automationEnabled !== false;
}

export type FollowUpDueReason =
  | "paused"
  | "outside_sending_window"
  | "quota_reached"
  | "waiting_for_delay"
  | "followup_automation_disabled"
  | "lead_ineligible"
  | "ready";

export interface FollowUpDueStatus {
  reason: FollowUpDueReason;
  message: string;
}

// Explains, in the same precedence order runTick() itself evaluates these
// gates, why a due follow-up for this lead is not being auto-sent right
// now. Read-only / display-only — never used to decide whether to actually
// send anything, so it can safely be called from a GET route without any
// risk of duplicating or contradicting the scheduler's own decision.
export function computeFollowUpDueReason(
  lead: Lead,
  settings: EmailAutomationSettings,
  allDrafts: EmailDraft[],
  allFollowUps: FollowUpMessage[],
  now: Date
): FollowUpDueStatus {
  if (settings.paused) {
    return { reason: "paused", message: "Automation is paused" };
  }

  if (!isWithinSendingWindow(settings, now)) {
    return { reason: "outside_sending_window", message: "Outside the configured sending window — waiting for the next sending window" };
  }

  const sentToday = allDrafts.filter(
    (d) => d.sendStatus === "sent" && d.sentAt && new Date(d.sentAt).toDateString() === now.toDateString()
  ).length;
  const followUpsSentToday = allFollowUps.filter((m) => new Date(m.sentAt).toDateString() === now.toDateString()).length;
  const remainingQuota = settings.dailySendLimit - sentToday - followUpsSentToday;
  if (remainingQuota <= 0) {
    return { reason: "quota_reached", message: "Daily sending quota reached — will resume once the quota resets" };
  }

  const lastDraftSendMs = Math.max(0, ...allDrafts.filter((d) => d.sentAt).map((d) => new Date(d.sentAt as string).getTime()));
  const lastFollowUpSendMs = Math.max(0, ...allFollowUps.map((m) => new Date(m.sentAt).getTime()));
  const lastSendMs = Math.max(lastDraftSendMs, lastFollowUpSendMs);
  if (lastSendMs > 0 && now.getTime() - lastSendMs < settings.delayBetweenEmailsMinutes * 60_000) {
    return { reason: "waiting_for_delay", message: "Waiting for the delay between emails to elapse" };
  }

  if (!settings.autoFollowUpEnabled) {
    return { reason: "followup_automation_disabled", message: "Automatic follow-ups are disabled in Settings" };
  }

  if (!isEligible(lead) || !lead.email) {
    const detail = !lead.email
      ? "Lead has no revealed email address"
      : !lead.automationEnabled
      ? "Automation is disabled for this lead"
      : `Lead is ${lead.engagementStatus}`;
    return { reason: "lead_ineligible", message: detail };
  }

  return { reason: "ready", message: "Eligible and ready — will send on the next automation cycle" };
}
