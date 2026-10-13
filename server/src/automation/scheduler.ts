import { leadsRepository } from "../db/leadsRepository";
import { researchBriefsRepository } from "../db/researchBriefsRepository";
import { emailDraftsRepository } from "../db/emailDraftsRepository";
import { automationSettingsRepository } from "../db/automationSettingsRepository";
import { followUpTasksRepository } from "../db/followUpTasksRepository";
import { followUpMessagesRepository } from "../db/followUpMessagesRepository";
import { generateDraftForLead, sendDraftForLead } from "../services/emailPipeline";
import { sendFollowUp } from "../services/followUpPipeline";
import { MAX_AUTO_SEND_ATTEMPTS, STUCK_SENDING_THRESHOLD_MS } from "../services/sendRetryPolicy";
import { isWithinSendingWindow, isEligible } from "./followUpEligibility";
import type { Lead } from "../types/lead";
import type { EmailDraft } from "../types/email";

const TICK_INTERVAL_MS = 60_000;
const MAX_AUTO_DRAFTS_PER_TICK = 5;

// A draft is a valid auto-send candidate if it's never been sent, if it's a
// "sending" leftover from a crash old enough that nothing is still waiting
// on it, or if it failed but hasn't exhausted its bounded retry budget and
// its backoff delay has elapsed.
function isDraftSendEligible(draft: EmailDraft, now: Date): boolean {
  if (draft.sendStatus === "not_sent") return true;
  if (draft.sendStatus === "sending") {
    return !!draft.lastAttemptAt && now.getTime() - new Date(draft.lastAttemptAt).getTime() >= STUCK_SENDING_THRESHOLD_MS;
  }
  if (draft.sendStatus === "failed") {
    if (draft.sendAttempts >= MAX_AUTO_SEND_ATTEMPTS) return false;
    if (!draft.nextRetryAt) return true;
    return now.getTime() >= new Date(draft.nextRetryAt).getTime();
  }
  return false;
}

async function runTick(): Promise<void> {
  const settings = await automationSettingsRepository.get();
  if (settings.paused) return;
  if (!settings.autoDraftEnabled && !settings.autoSendEnabled && !settings.autoFollowUpEnabled) return;

  const now = new Date();
  const leads = await leadsRepository.list();
  const leadsById = new Map(leads.map((l) => [l.id, l]));

  // --- Auto-draft: safe to run regardless of sending window/quota, since it
  // never contacts the prospect. Bounded per tick as a simple safety valve.
  if (settings.autoDraftEnabled) {
    const drafts = await emailDraftsRepository.listAll();
    const draftedLeadIds = new Set(drafts.map((d) => d.leadId));
    let drafted = 0;
    for (const lead of leads) {
      if (drafted >= MAX_AUTO_DRAFTS_PER_TICK) break;
      if (!isEligible(lead) || draftedLeadIds.has(lead.id)) continue;
      const brief = await researchBriefsRepository.getByLeadId(lead.id);
      if (!brief || brief.status !== "complete") continue;
      try {
        await generateDraftForLead(lead.id, false);
        drafted += 1;
      } catch (err) {
        console.error(`[automation] auto-draft failed for lead ${lead.id}: ${(err as Error).message}`);
      }
    }
  }

  if (!isWithinSendingWindow(settings, now)) return;

  const allDrafts = await emailDraftsRepository.listAll();
  const allFollowUps = await followUpMessagesRepository.listAll();

  const sentToday = allDrafts.filter(
    (d) => d.sendStatus === "sent" && d.sentAt && new Date(d.sentAt).toDateString() === now.toDateString()
  ).length;
  const followUpsSentToday = allFollowUps.filter(
    (m) => new Date(m.sentAt).toDateString() === now.toDateString()
  ).length;
  const remainingQuota = settings.dailySendLimit - sentToday - followUpsSentToday;
  if (remainingQuota <= 0) return;

  const lastDraftSendMs = Math.max(0, ...allDrafts.filter((d) => d.sentAt).map((d) => new Date(d.sentAt as string).getTime()));
  const lastFollowUpSendMs = Math.max(0, ...allFollowUps.map((m) => new Date(m.sentAt).getTime()));
  const lastSendMs = Math.max(lastDraftSendMs, lastFollowUpSendMs);
  if (lastSendMs > 0 && now.getTime() - lastSendMs < settings.delayBetweenEmailsMinutes * 60_000) return;

  // Follow-ups take priority over fresh initial sends since they're
  // already-committed obligations with their own schedule. Within follow-ups,
  // resuming anything stuck "sending" from a crash takes priority over
  // starting a new due one. Follow-up *tasks* are scheduled as soon as their
  // initial email is sent (see emailPipeline.ts), regardless of this toggle —
  // autoFollowUpEnabled only gates whether this scheduler is allowed to
  // actually dispatch a due one automatically.
  if (settings.autoFollowUpEnabled) {
    const stuck = await followUpTasksRepository.listStuckSending(now, STUCK_SENDING_THRESHOLD_MS);
    const due = stuck.length > 0 ? stuck : await followUpTasksRepository.listPendingDue(now);
    for (const task of due) {
      const lead = leadsById.get(task.leadId);
      if (!lead || !isEligible(lead) || !lead.email) {
        await followUpTasksRepository.setStatus(task.id, "cancelled", "Lead no longer eligible for automation");
        continue;
      }
      await sendFollowUp(lead, task, settings);
      return; // one send per tick, to respect delayBetweenEmailsMinutes precisely
    }
  }

  if (settings.autoSendEnabled) {
    const candidates = leads
      .filter((l) => isEligible(l) && l.email)
      .map((l) => ({ lead: l, draft: allDrafts.find((d) => d.leadId === l.id) }))
      .filter((c): c is { lead: Lead; draft: EmailDraft } => !!c.draft && isDraftSendEligible(c.draft, now))
      .sort((a, b) => {
        // Resuming a stuck send takes priority over starting or retrying others.
        const aStuck = a.draft.sendStatus === "sending" ? 0 : 1;
        const bStuck = b.draft.sendStatus === "sending" ? 0 : 1;
        if (aStuck !== bStuck) return aStuck - bStuck;
        return new Date(a.draft.generatedAt).getTime() - new Date(b.draft.generatedAt).getTime();
      });

    const next = candidates[0];
    if (next) {
      try {
        // sendDraftForLead schedules the first follow-up itself (anchored to
        // the real send timestamp) if follow-ups are configured.
        await sendDraftForLead(next.lead.id, false);
      } catch (err) {
        console.error(`[automation] auto-send failed for lead ${next.lead.id}: ${(err as Error).message}`);
      }
    }
  }
}

let running = false;

// Recursive setTimeout rather than setInterval: guarantees the next tick
// never starts before the previous one's async work (which includes network
// calls to Groq/Resend) has fully finished, so ticks can't overlap and
// double-process the same due follow-up or send the same lead twice.
export function startAutomationScheduler(): void {
  if (running) return;
  running = true;

  const loop = async () => {
    try {
      await runTick();
    } catch (err) {
      console.error(`[automation] tick failed: ${(err as Error).message}`);
    } finally {
      setTimeout(loop, TICK_INTERVAL_MS);
    }
  };

  setTimeout(loop, TICK_INTERVAL_MS);
}
