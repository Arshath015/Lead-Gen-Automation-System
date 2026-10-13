// Append-only lifecycle log for a lead. Recorded going forward only, from
// the exact moment this feature shipped — never backfilled/fabricated for
// leads that already existed, since we have no reliable record of their
// actual past events.
export type LeadActivityType =
  | "lead_created"
  | "status_changed"
  | "engagement_changed"
  | "automation_toggled"
  | "email_revealed"
  | "research_completed"
  | "research_failed"
  | "draft_generated"
  | "draft_edited"
  | "email_sent"
  | "email_send_failed"
  | "follow_up_sent"
  | "sent_to_crm"
  | "webhook_replied"
  | "webhook_bounced"
  | "webhook_complained"
  // First-occurrence-only engagement signals from real Resend webhook events
  // (see engagementPipeline.ts) — repeat opens/clicks of the same email are
  // still recorded in full in the engagementEvents collection for analytics,
  // but only the first of each type per email is logged here, so this feed
  // stays a readable lifecycle log rather than a raw event firehose.
  | "webhook_delivered"
  | "webhook_opened"
  | "webhook_clicked";

export interface LeadActivityEvent {
  id: string;
  leadId: string;
  type: LeadActivityType;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
