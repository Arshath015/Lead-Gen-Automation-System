import type { WebhookEventPayload } from "resend";
import { leadsRepository } from "../db/leadsRepository";
import { emailDraftsRepository } from "../db/emailDraftsRepository";
import { followUpMessagesRepository } from "../db/followUpMessagesRepository";
import { followUpTasksRepository } from "../db/followUpTasksRepository";
import { leadActivityRepository } from "../db/leadActivityRepository";
import { engagementEventsRepository } from "../db/engagementEventsRepository";
import { resolveApproxLocation, extractOriginatingIpFromHeaders } from "./geoLookup";
import { fetchReceivedEmailHeaders } from "../email/resendAdapter";
import type { EngagementEvent, EngagementEventType } from "../types/engagement";
import type { EngagementStatus } from "../types/lead";
import type { LeadActivityType } from "../types/activity";

// Matches an event back to the exact send that produced it (the initial
// draft or a specific follow-up message) via Resend's own send-id — far more
// reliable than matching by recipient address, which can collide when the
// same test inbox is reused across multiple leads during manual QA. Also the
// single lookup point used to backfill the real SMTP Message-ID onto that
// same record once a webhook reports it (see persistSmtpMessageId below).
type ResendEmailMatch = { kind: "draft"; leadId: string; resendMessageId: string; smtpMessageId: string | null } | { kind: "followUp"; leadId: string; resendMessageId: string; smtpMessageId: string | null };

async function findByResendEmailId(emailId: string): Promise<ResendEmailMatch | null> {
  const drafts = await emailDraftsRepository.listAll();
  const draftMatch = drafts.find((d) => d.resendMessageId === emailId);
  if (draftMatch) {
    return { kind: "draft", leadId: draftMatch.leadId, resendMessageId: emailId, smtpMessageId: draftMatch.smtpMessageId };
  }

  const messages = await followUpMessagesRepository.listAll();
  const messageMatch = messages.find((m) => m.resendMessageId === emailId);
  return messageMatch
    ? { kind: "followUp", leadId: messageMatch.leadId, resendMessageId: emailId, smtpMessageId: messageMatch.smtpMessageId }
    : null;
}

// Resend's synchronous send response only ever returns its own internal
// send-id — the real RFC5322 Message-ID (needed to build In-Reply-To/
// References on a later follow-up) only shows up asynchronously, in the
// first webhook event that reports it. Written once and left alone after —
// idempotent no-op on every later event for the same email, including
// webhook redeliveries.
async function persistSmtpMessageId(match: ResendEmailMatch, smtpMessageId: string): Promise<void> {
  if (match.smtpMessageId) return;
  if (match.kind === "draft") {
    await emailDraftsRepository.update(match.leadId, { smtpMessageId });
  } else {
    await followUpMessagesRepository.updateByResendMessageId(match.resendMessageId, { smtpMessageId });
  }
}

async function findLeadIdByEmail(email: string): Promise<string | null> {
  const all = await leadsRepository.list();
  const match = all.find((l) => l.email && l.email.toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}

interface ExtractedSignal {
  type: EngagementEventType;
  emailId: string | null;
  messageId: string | null;
  occurredAt: string;
  ip: string | null;
  userAgent: string | null;
  clickedLink: string | null;
  recipientEmail: string | null; // data.to[0], used as a fallback match
  senderEmail: string | null; // data.from, used for reply matching
}

// Extracts the fields this pipeline cares about, narrowed per event.type in
// one switch (rather than a separate "map the type" pass) so each branch's
// `event.data` is properly narrowed by TypeScript to that event's own data
// shape. Returns null for event types we don't act on (email.sent/scheduled/
// delivery_delayed/failed/suppressed, contact.*, domain.*, suppression.*) —
// the route still acknowledges those with a 200, they're just not recorded.
// Async only because the "email.received" branch may fetch raw headers.
async function extractSignal(event: WebhookEventPayload): Promise<ExtractedSignal | null> {
  switch (event.type) {
    case "email.received": {
      // The webhook payload itself carries no IP or headers at all (see
      // ReceivedEmailEventData in the resend package's types) — the only way
      // to even attempt reply geolocation is a follow-up GET for the raw
      // headers, then a best-effort parse of the "Received"/"X-Originating-IP"
      // chain. Both steps fail closed to null on any error or absence, which
      // flows straight into resolveApproxLocation's existing null-ip
      // short-circuit below — i.e. "no usable IP" and "lookup failed" both
      // land on the same honest "location unavailable" outcome as an
      // undetectable open/click already does.
      const emailId = event.data.email_id ?? null;
      const headers = emailId ? await fetchReceivedEmailHeaders(emailId) : null;
      const ip = extractOriginatingIpFromHeaders(headers);
      return {
        type: "received",
        emailId,
        messageId: event.data.message_id ?? null,
        occurredAt: event.created_at,
        ip,
        userAgent: null,
        clickedLink: null,
        recipientEmail: null,
        senderEmail: event.data.from,
      };
    }

    case "email.clicked":
      return {
        type: "clicked",
        emailId: event.data.email_id ?? null,
        messageId: event.data.message_id ?? null,
        occurredAt: event.created_at,
        ip: event.data.click?.ipAddress || null,
        userAgent: event.data.click?.userAgent || null,
        clickedLink: event.data.click?.link || null,
        recipientEmail: event.data.to?.[0] ?? null,
        senderEmail: null,
      };

    case "email.delivered":
    case "email.opened":
    case "email.bounced":
    case "email.complained": {
      // The installed Resend SDK's type declarations don't list an IP field
      // on "opened" (only "clicked" carries one, via EmailClick), but the
      // actual webhook JSON isn't schema-validated by the SDK before
      // verify() hands it back to us — if Resend's real payload does include
      // one under a differently-named field, this picks it up without
      // assuming a shape the types don't guarantee. Confirm against a real
      // "opened" payload in the Resend dashboard's webhook event log if
      // precise open-location accuracy matters; absent any of these fields,
      // location simply resolves to null ("Unavailable"), which is the
      // correct, honest fallback either way.
      const rawData = event.data as unknown as Record<string, unknown>;
      const ip =
        typeof rawData.ipAddress === "string"
          ? rawData.ipAddress
          : typeof (rawData.open as Record<string, unknown> | undefined)?.ipAddress === "string"
          ? ((rawData.open as Record<string, unknown>).ipAddress as string)
          : null;
      const userAgent = typeof rawData.userAgent === "string" ? rawData.userAgent : null;
      const type: EngagementEventType =
        event.type === "email.delivered"
          ? "delivered"
          : event.type === "email.opened"
          ? "opened"
          : event.type === "email.bounced"
          ? "bounced"
          : "complained";

      return {
        type,
        emailId: event.data.email_id ?? null,
        messageId: event.data.message_id ?? null,
        occurredAt: event.created_at,
        ip,
        userAgent,
        clickedLink: null,
        recipientEmail: event.data.to?.[0] ?? null,
        senderEmail: null,
      };
    }

    default:
      return null;
  }
}

const TERMINAL_STATUS: Partial<Record<EngagementEventType, EngagementStatus>> = {
  bounced: "bounced",
  complained: "unsubscribed",
  received: "replied",
};

const TERMINAL_ACTIVITY: Partial<Record<EngagementEventType, { type: LeadActivityType; summary: string }>> = {
  bounced: { type: "webhook_bounced", summary: "Email bounced" },
  complained: { type: "webhook_complained", summary: "Marked as spam / unsubscribed" },
  received: { type: "webhook_replied", summary: "Prospect replied to an email" },
};

const MILESTONE_ACTIVITY_TYPE: Record<"delivered" | "opened" | "clicked", LeadActivityType> = {
  delivered: "webhook_delivered",
  opened: "webhook_opened",
  clicked: "webhook_clicked",
};

// Exported for a focused wording test — no other caller.
export function locationSuffix(location: EngagementEvent["location"]): string {
  if (!location) return "";
  // geoLookup.ts withholds every geo field once an IP is flagged
  // `likelyProxied` (Gmail's image proxy, Apple Private Relay, etc.) — say so
  // explicitly rather than silently falling through to the empty-parts case
  // below, which would read as "no location data at all" instead of "we
  // have a real open/click, but its IP belongs to a proxy, not the recipient."
  if (location.likelyProxied) return " (location unavailable — routed through an email provider proxy)";
  const parts = [location.city, location.region, location.country].filter(Boolean);
  if (parts.length === 0) return "";
  return ` (approx. ${parts.join(", ")})`;
}

// Applies the terminal engagement-status side effects a bounce/complaint/
// reply always carries: stop automation, cancel pending follow-ups, and
// narrate the transition on the lead's Activity feed. Mirrors what the
// manual PATCH /leads/:id route does when a human sets the same status by
// hand, since a webhook-driven transition should behave identically.
async function applyTerminalStatus(leadId: string, type: EngagementEventType): Promise<void> {
  const status = TERMINAL_STATUS[type];
  const activity = TERMINAL_ACTIVITY[type];
  if (!status || !activity) return;
  await leadsRepository.update(leadId, { engagementStatus: status });
  await followUpTasksRepository.cancelAllForLead(leadId);
  await leadActivityRepository.record(leadId, activity.type, activity.summary);
}

// Entry point for every verified Resend webhook delivery. `webhookEventId` is
// the `svix-id` header — the idempotency key that makes a redelivered webhook
// a safe no-op instead of double-applying a status change or double-counting
// an engagement metric.
export async function processResendWebhookEvent(event: WebhookEventPayload, webhookEventId: string): Promise<void> {
  const signal = await extractSignal(event);
  if (!signal) return; // Unhandled event type — nothing to record or act on.
  const { type } = signal;

  // "received" is a reply the prospect sent us — its emailId/messageId
  // describe *that* inbound message, not one of ours, so it's matched by
  // sender address only and never used for our own smtpMessageId backfill.
  const emailMatch = type !== "received" && signal.emailId ? await findByResendEmailId(signal.emailId) : null;

  const leadId =
    type === "received"
      ? signal.senderEmail
        ? await findLeadIdByEmail(signal.senderEmail)
        : null
      : emailMatch?.leadId ?? (signal.recipientEmail ? await findLeadIdByEmail(signal.recipientEmail) : null);

  if (emailMatch && signal.messageId) {
    await persistSmtpMessageId(emailMatch, signal.messageId);
  }

  const location = await resolveApproxLocation(signal.ip);

  const stored = await engagementEventsRepository.recordIfNew(webhookEventId, {
    type,
    emailId: signal.emailId,
    messageId: signal.messageId,
    leadId,
    occurredAt: signal.occurredAt,
    ip: signal.ip,
    userAgent: signal.userAgent,
    clickedLink: signal.clickedLink,
    location,
  });
  if (!stored) return; // Duplicate delivery of an already-processed webhook event.
  if (!leadId) return; // Valid, newly-recorded event, but no matching lead to act on.

  if (type === "bounced" || type === "complained" || type === "received") {
    await applyTerminalStatus(leadId, type);
    return;
  }

  // delivered/opened/clicked: never mutate engagement status or automation
  // eligibility — these are signals, not outcomes. Only the first occurrence
  // of each type per email is written to the Activity feed, so repeat opens
  // (common — image proxies, re-opens, link previews) don't flood it; every
  // occurrence is still preserved in engagementEvents for the Tracking
  // timeline's "opened Nx" display and the dashboard's aggregate rates.
  if (!signal.emailId) return; // Can't correlate repeats without it; the raw event is still stored above.
  const occurrences = await engagementEventsRepository.countOccurrencesOfType(signal.emailId, type);
  if (occurrences !== 1) return;

  const activityType = MILESTONE_ACTIVITY_TYPE[type as "delivered" | "opened" | "clicked"];
  const summary =
    type === "opened"
      ? `Email opened${locationSuffix(location)} — an engagement signal, not confirmation the message was read`
      : type === "clicked"
      ? `Link clicked${locationSuffix(location)}${signal.clickedLink ? `: ${signal.clickedLink}` : ""}`
      : `Email delivered`;
  await leadActivityRepository.record(leadId, activityType, summary, {
    ip: signal.ip,
    location,
    ...(signal.clickedLink ? { link: signal.clickedLink } : {}),
  });
}
