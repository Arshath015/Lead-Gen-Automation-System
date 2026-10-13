import { researchBriefsRepository } from "../db/researchBriefsRepository";
import { emailDraftsRepository } from "../db/emailDraftsRepository";
import { followUpTasksRepository } from "../db/followUpTasksRepository";
import { followUpMessagesRepository } from "../db/followUpMessagesRepository";
import { leadActivityRepository } from "../db/leadActivityRepository";
import { automationSettingsRepository } from "../db/automationSettingsRepository";
import { groqAdapter } from "../llm/groqAdapter";
import { resendAdapter } from "../email/resendAdapter";
import { MAX_AUTO_SEND_ATTEMPTS, computeRetryBackoffMs } from "./sendRetryPolicy";
import type { EmailAutomationSettings } from "../types/automation";
import type { Lead } from "../types/lead";
import type { FollowUpTask, FollowUpMessage } from "../types/automation";
import type { EmailDraft } from "../types/email";

// Every follow-up in a lead's sequence reuses the exact original subject
// (Re:-prefixed) rather than letting the LLM invent a new one each time —
// required for Gmail (and most clients) to thread a conversation, which
// keys off matching subject in addition to In-Reply-To/References. Idempotent
// against being applied more than once, so re-deriving it from the original
// draft's subject on every follow-up (rather than chaining off the previous
// follow-up's subject) can never stack into "Re: Re: Re: ...".
export function buildFollowUpSubject(originalSubject: string): string {
  return /^re:\s/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
}

// Chains every prior real SMTP Message-ID for this lead — the initial send
// followed by any earlier follow-ups, oldest first — into the References
// header, with In-Reply-To set to just the immediately preceding one, per
// RFC 5322 conventions for a threaded reply. Prior sends whose Message-ID
// hasn't been backfilled yet (see engagementPipeline.ts — it only arrives
// asynchronously via webhook) are skipped rather than breaking the chain
// with a null entry; if none are known yet, returns {} so the send simply
// goes out without threading headers instead of failing.
export function buildThreadingHeaders(
  originalDraft: Pick<EmailDraft, "smtpMessageId">,
  priorFollowUps: Pick<FollowUpMessage, "smtpMessageId">[]
): { inReplyTo?: string; references?: string[] } {
  const chain = [originalDraft.smtpMessageId, ...priorFollowUps.map((m) => m.smtpMessageId)].filter(
    (id): id is string => !!id
  );
  if (chain.length === 0) return {};
  return { references: chain, inReplyTo: chain[chain.length - 1] };
}

// Called once, right after ANY successful initial send — manual or automated
// — so the follow-up window always starts from the exact real send
// timestamp, regardless of who triggered the send. Guarded against creating
// a second sequence-1 task if one already exists (e.g. a force-resend of an
// already-sent draft), and against scheduling when follow-ups are disabled
// entirely (followUpCount 0). Deliberately NOT gated on autoFollowUpEnabled —
// that toggle controls whether the scheduler is allowed to *send* a due
// follow-up automatically, not whether one gets scheduled in the first
// place; a manually-triggered "Send follow-up now" must work even while
// automatic sending is off.
export async function scheduleFirstFollowUpIfConfigured(leadId: string, sentAtIso: string): Promise<void> {
  const settings = await automationSettingsRepository.get();
  if (settings.followUpCount <= 0) return;

  const existing = await followUpTasksRepository.listByLeadId(leadId);
  if (existing.length > 0) return;

  const scheduledFor = new Date(new Date(sentAtIso).getTime() + settings.followUpDelayDays * 86_400_000).toISOString();
  await followUpTasksRepository.create(leadId, 1, scheduledFor);
}

// Sends a specific follow-up task right now, whether called by the scheduler
// (because it's due) or by a manual "Send follow-up now" action. Either way
// it's the exact same durable, idempotent send path: content is generated
// once and persisted before any Resend call, the task moves through
// pending -> sending -> sent/failed, and listPendingDue (what the scheduler
// polls) will never see this task again once it leaves "pending" — so a
// manual send here can never later be duplicated by the automatic scheduler
// picking up the same task.
export async function sendFollowUp(lead: Lead, task: FollowUpTask, settings: EmailAutomationSettings): Promise<void> {
  // Resuming a "sending" task left over from a crash reuses its already-
  // persisted content, attempt number, and idempotency key rather than
  // regenerating and starting fresh — replaying the identical payload is
  // what lets Resend recognize a retried request as a duplicate instead of
  // sending a second email.
  const isResuming = task.status === "sending" && !!task.idempotencyKey;

  // Fetched unconditionally (not just when generating fresh content) because
  // the original draft is also where the thread's subject and root
  // Message-ID come from — needed on every send, including a resumed one.
  const originalDraft = await emailDraftsRepository.getByLeadId(lead.id);
  if (!originalDraft) {
    await followUpTasksRepository.markFailed(task.id, "Missing original draft", null);
    return;
  }
  const subject = buildFollowUpSubject(originalDraft.subject);

  let body = task.body;
  let model = task.model;

  if (!body) {
    const brief = await researchBriefsRepository.getByLeadId(lead.id);
    if (!brief || brief.status !== "complete") {
      await followUpTasksRepository.markFailed(task.id, "Missing research brief", null);
      return;
    }

    const generated = await groqAdapter.generateFollowUpEmail(
      lead,
      { companyOverview: brief.companyOverview, recentNews: brief.recentNews, painPoints: brief.painPoints },
      originalDraft.subject,
      task.sequenceNumber,
      !!settings.emailSignature
    );
    // The LLM's own subject is discarded — subject continuity is enforced
    // above, deterministically, not left to generation.
    body = generated.body;
    model = generated.model;
    await followUpTasksRepository.setContent(task.id, subject, body, model);
  }

  const priorFollowUps = (await followUpMessagesRepository.listByLeadId(lead.id)).filter(
    (m) => m.sequenceNumber < task.sequenceNumber
  );
  const { inReplyTo, references } = buildThreadingHeaders(originalDraft, priorFollowUps);

  const attempt = isResuming ? task.attempts : task.attempts + 1;
  const idempotencyKey = isResuming ? (task.idempotencyKey as string) : `follow-up-task:${task.id}:attempt:${attempt}`;

  await followUpTasksRepository.markSending(task.id, idempotencyKey, attempt);

  try {
    const result = await resendAdapter.send({ to: lead.email as string, subject, body, idempotencyKey, inReplyTo, references });

    await followUpMessagesRepository.create({
      leadId: lead.id,
      followUpTaskId: task.id,
      sequenceNumber: task.sequenceNumber,
      subject,
      body,
      model,
      sentAt: new Date().toISOString(),
      resendMessageId: result.id,
      // Backfilled asynchronously once a Resend webhook reports it — see
      // engagementPipeline.ts.
      smtpMessageId: null,
    });
    await followUpTasksRepository.markSent(task.id);
    await leadActivityRepository.record(lead.id, "follow_up_sent", `Follow-up #${task.sequenceNumber} sent: "${subject}"`, {
      resendMessageId: result.id,
    });

    if (task.sequenceNumber < settings.followUpCount) {
      const scheduledFor = new Date(Date.now() + settings.followUpDelayDays * 86_400_000).toISOString();
      await followUpTasksRepository.create(lead.id, task.sequenceNumber + 1, scheduledFor);
    }
  } catch (err) {
    const retryAt =
      attempt < MAX_AUTO_SEND_ATTEMPTS ? new Date(Date.now() + computeRetryBackoffMs(attempt)).toISOString() : null;
    await followUpTasksRepository.markFailed(task.id, (err as Error).message, retryAt);
    await leadActivityRepository.record(
      lead.id,
      "email_send_failed",
      `Follow-up #${task.sequenceNumber} failed: ${(err as Error).message}`
    );
    console.error(`[automation] follow-up send failed for lead ${lead.id}: ${(err as Error).message}`);
  }
}
