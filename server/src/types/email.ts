// "sending" is a transient, durable marker written *before* the Resend API
// call is made and cleared right after — so a crash mid-send leaves visible
// evidence of an in-flight attempt (and its idempotency key) instead of
// silently reverting to "not_sent", which is what would let a restart
// resend a message that actually went through the first time.
export type SendStatus = "not_sent" | "sending" | "sent" | "failed";

export interface EmailDraft {
  id: string;
  leadId: string;
  researchBriefId: string | null;
  subject: string;
  body: string;
  model: string | null;
  editedByUser: boolean;
  generatedAt: string;
  updatedAt: string;
  sendStatus: SendStatus;
  sentAt: string | null;
  // Resend's own send-id (`data.id` from the synchronous send response) —
  // used for webhook correlation and send idempotency. Distinct from
  // smtpMessageId below, which is the real RFC5322 Message-ID and only
  // becomes known later, asynchronously, via a webhook delivery.
  resendMessageId: string | null;
  // The real SMTP `Message-ID` header value (e.g.
  // "<...@amazonses.com>"), backfilled from the first Resend webhook event
  // that reports it (see engagementPipeline.ts). Required to build correct
  // In-Reply-To/References headers on a follow-up — Resend's synchronous
  // send response never includes it, only its own internal id does.
  smtpMessageId: string | null;
  sendError: string | null;
  sendAttempts: number;
  lastAttemptAt: string | null;
  // Automation-only retry gate; manual sends from the UI ignore this and can
  // always be triggered (subject to the existing already-sent/force guard).
  nextRetryAt: string | null;
  // Passed to Resend as the Idempotency-Key header. Reused verbatim across a
  // crash-and-resume of the *same* attempt so Resend can recognize a retried
  // request as a duplicate instead of sending a second email.
  sendIdempotencyKey: string | null;
}

export type NewEmailDraft = Omit<
  EmailDraft,
  | "id"
  | "leadId"
  | "updatedAt"
  | "sendStatus"
  | "sentAt"
  | "resendMessageId"
  | "smtpMessageId"
  | "sendError"
  | "sendAttempts"
  | "lastAttemptAt"
  | "nextRetryAt"
  | "sendIdempotencyKey"
>;
