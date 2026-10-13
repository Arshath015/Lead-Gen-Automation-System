// Engagement events derived automatically from real Resend webhook deliveries
// (delivered/opened/clicked/bounced/complained/received). Never user-editable —
// this is the append-only source of truth the Tracking timeline and dashboard
// analytics are built from, distinct from the manually-editable
// `Lead.engagementStatus` flag (which a human can still override to stop
// automation regardless of what the real events say).
export type EngagementEventType = "delivered" | "opened" | "clicked" | "bounced" | "complained" | "received";

// Best-effort, provider-supplied approximation only — never treated or
// displayed as the recipient's exact physical location. `city`/`region` are
// omitted (left null) whenever the lookup couldn't resolve them, even if
// `country` is known. `likelyProxied` is set when the IP resolves to known
// email/image-proxy infrastructure (Gmail's own proxy, Apple Mail Privacy
// Protection / iCloud Private Relay, Outlook/Yahoo image proxying, or any
// other IP flagged as hosting/datacenter-class) — see geoLookup.ts. In that
// case `country`/`region`/`city` are ALL null: the resolved location belongs
// to the proxy's own infrastructure (which may have no geographic
// relationship to the recipient whatsoever — e.g. Gmail's proxy is
// predominantly US-based regardless of where the recipient actually is), not
// the recipient, so it must never be shown as if it were. Callers surface
// `likelyProxied` as an explicit "location unavailable — proxy" message
// rather than silently omitting the caveat or (worse) showing the proxy's
// location as an approximation of the recipient's.
export interface ApproxLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  approximate: true;
  likelyProxied: boolean;
}

export interface EngagementEvent {
  id: string;
  // The Resend/Svix webhook delivery id (the `svix-id` header). Unique per
  // webhook delivery attempt group — used as the idempotency key so a
  // redelivered (retried) webhook can never be double-applied.
  webhookEventId: string;
  type: EngagementEventType;
  // Resend's own id for the sent email (`data.email_id`), used to associate
  // this event with the exact originating send (initial draft or a specific
  // follow-up) via its stored resendMessageId — more precise than matching
  // by recipient address, which can collide when the same test address is
  // reused across multiple leads.
  emailId: string | null;
  messageId: string | null;
  // Resolved lead, if any lead's sent email matches this event. Null when no
  // match could be made (e.g. the email was deleted, or the event is for an
  // address not in our leads).
  leadId: string | null;
  occurredAt: string;
  ip: string | null;
  userAgent: string | null;
  // Only present for "clicked" events.
  clickedLink: string | null;
  location: ApproxLocation | null;
  createdAt: string;
}
