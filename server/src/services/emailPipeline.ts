import { leadsRepository } from "../db/leadsRepository";
import { researchBriefsRepository } from "../db/researchBriefsRepository";
import { emailDraftsRepository } from "../db/emailDraftsRepository";
import { leadActivityRepository } from "../db/leadActivityRepository";
import { automationSettingsRepository } from "../db/automationSettingsRepository";
import { groqAdapter } from "../llm/groqAdapter";
import { resendAdapter } from "../email/resendAdapter";
import { scheduleFirstFollowUpIfConfigured } from "./followUpPipeline";
import { computeRetryBackoffMs } from "./sendRetryPolicy";
import type { EmailDraft } from "../types/email";

// Shared by both the manual routes (emailDrafts.routes.ts) and the automation
// scheduler, so "generate" and "send" behave identically — and carry the same
// safety guards (no double-send, no send without an email) — no matter who
// triggered them.

export { MAX_AUTO_SEND_ATTEMPTS, STUCK_SENDING_THRESHOLD_MS, computeRetryBackoffMs } from "./sendRetryPolicy";

export async function generateDraftForLead(leadId: string, force: boolean): Promise<EmailDraft> {
  const lead = await leadsRepository.getById(leadId);
  if (!lead) throw new Error("Lead not found");

  const brief = await researchBriefsRepository.getByLeadId(leadId);
  if (!brief || brief.status !== "complete") {
    throw new Error("Lead has no completed research brief yet; run research first");
  }

  const settings = await automationSettingsRepository.get();
  const generated = await groqAdapter.generateEmailDraft(
    lead,
    {
      companyOverview: brief.companyOverview,
      recentNews: brief.recentNews,
      painPoints: brief.painPoints,
    },
    !!settings.emailSignature
  );

  const draft = await emailDraftsRepository.upsert(
    leadId,
    {
      researchBriefId: brief.id,
      subject: generated.subject,
      body: generated.body,
      model: generated.model,
      editedByUser: false,
      generatedAt: new Date().toISOString(),
    },
    { force }
  );
  await leadActivityRepository.record(leadId, "draft_generated", `Draft generated: "${draft.subject}"`);
  return draft;
}

export async function sendDraftForLead(leadId: string, force: boolean): Promise<EmailDraft> {
  const lead = await leadsRepository.getById(leadId);
  if (!lead) throw new Error("Lead not found");
  if (!lead.email) throw new Error("Lead has no revealed email address; reveal email first");

  const draft = await emailDraftsRepository.getByLeadId(leadId);
  if (!draft) throw new Error("Lead has no email draft yet; generate a draft first");
  if (draft.sendStatus === "sent" && !force) {
    throw new Error("Email already sent to this lead; pass force to resend");
  }

  // Resuming a "sending" draft left over from a crash reuses the exact same
  // attempt number and idempotency key rather than starting a fresh attempt —
  // if the original Resend call actually went through before the crash,
  // replaying the same idempotency key returns that same result instead of
  // sending a second email.
  const isResuming = draft.sendStatus === "sending" && !!draft.sendIdempotencyKey;
  const attempt = isResuming ? draft.sendAttempts : draft.sendAttempts + 1;
  const idempotencyKey = isResuming ? (draft.sendIdempotencyKey as string) : `email-draft:${draft.id}:attempt:${attempt}`;

  await emailDraftsRepository.update(leadId, {
    sendStatus: "sending",
    sendAttempts: attempt,
    lastAttemptAt: new Date().toISOString(),
    sendIdempotencyKey: idempotencyKey,
  });

  try {
    const result = await resendAdapter.send({
      to: lead.email,
      subject: draft.subject,
      body: draft.body,
      idempotencyKey,
    });
    const sentAt = new Date().toISOString();
    const updated = await emailDraftsRepository.update(leadId, {
      sendStatus: "sent",
      sentAt,
      resendMessageId: result.id,
      sendError: null,
      nextRetryAt: null,
    });
    await leadActivityRepository.record(leadId, "email_sent", `Email sent: "${draft.subject}"`, {
      resendMessageId: result.id,
    });
    // Anchored to this exact send timestamp — not a later "now" — so the
    // follow-up window always starts from when the email actually went out,
    // whether this was a manual send or an automated one.
    await scheduleFirstFollowUpIfConfigured(leadId, sentAt);
    return updated as EmailDraft;
  } catch (err) {
    await emailDraftsRepository.update(leadId, {
      sendStatus: "failed",
      sendError: (err as Error).message,
      nextRetryAt: new Date(Date.now() + computeRetryBackoffMs(attempt)).toISOString(),
    });
    await leadActivityRepository.record(leadId, "email_send_failed", `Send failed: ${(err as Error).message}`);
    throw err;
  }
}
