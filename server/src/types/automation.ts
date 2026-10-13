export interface EmailAutomationSettings {
  // Master kill switch — when true, the scheduler does nothing at all,
  // regardless of the three toggles below. Lets the user halt everything
  // instantly without losing their configured values.
  paused: boolean;
  autoDraftEnabled: boolean;
  autoSendEnabled: boolean;
  autoFollowUpEnabled: boolean;
  dailySendLimit: number;
  delayBetweenEmailsMinutes: number;
  sendingDays: number[]; // 0=Sunday .. 6=Saturday
  sendingHourStart: number; // 0-23, inclusive
  sendingHourEnd: number; // 0-23, exclusive
  followUpCount: number; // max follow-ups per lead after the initial send
  followUpDelayDays: number; // days between each send in the sequence
  // Sanitized HTML from the rich-text signature editor. Appended to the
  // outgoing message (both text and html versions) at send time only —
  // never written into a draft's stored body — so editing, regenerating, or
  // retrying a draft can never duplicate it. Empty string means no signature.
  emailSignature: string;
  updatedAt: string;
}

export const DEFAULT_AUTOMATION_SETTINGS: EmailAutomationSettings = {
  paused: false,
  autoDraftEnabled: false,
  autoSendEnabled: false,
  autoFollowUpEnabled: false,
  dailySendLimit: 20,
  delayBetweenEmailsMinutes: 5,
  sendingDays: [1, 2, 3, 4, 5],
  sendingHourStart: 9,
  sendingHourEnd: 17,
  followUpCount: 2,
  followUpDelayDays: 3,
  emailSignature: "",
  updatedAt: new Date(0).toISOString(),
};

// "sending" is a durable marker written before the Resend call and cleared
// right after, mirroring EmailDraft's sendStatus — it lets a crash mid-send
// be detected and safely resumed on restart instead of silently retrying
// from scratch (see followUpTasksRepository.markSending/markResult).
export type FollowUpTaskStatus = "pending" | "sending" | "sent" | "cancelled" | "failed";

export interface FollowUpTask {
  id: string;
  leadId: string;
  sequenceNumber: number;
  scheduledFor: string;
  status: FollowUpTaskStatus;
  error: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  // Reused verbatim when resuming a crashed "sending" task, so Resend
  // recognizes a retried request as a duplicate of the original attempt.
  idempotencyKey: string | null;
  // Generated once (before the first send attempt) and persisted so every
  // retry of the same attempt replays the exact same payload — required for
  // the idempotency key to protect against a duplicate send, since Resend
  // rejects a reused key if the request body doesn't match.
  subject: string | null;
  body: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpMessage {
  id: string;
  leadId: string;
  followUpTaskId: string;
  sequenceNumber: number;
  subject: string;
  body: string;
  model: string | null;
  sentAt: string;
  // Resend's own send-id, used for webhook correlation/idempotency.
  resendMessageId: string | null;
  // The real SMTP Message-ID, backfilled asynchronously from the first
  // Resend webhook event that reports it — see EmailDraft.smtpMessageId for
  // why this is a separate field from resendMessageId.
  smtpMessageId: string | null;
}
