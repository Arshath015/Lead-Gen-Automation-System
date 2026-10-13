import { useEffect, useMemo, useState } from "react";
import {
  Send,
  Reply,
  MailWarning,
  Ban,
  Hourglass,
  XCircle,
  Clock3,
  ThumbsDown,
  Zap,
  MailCheck,
  Eye,
  MousePointerClick,
} from "lucide-react";
import { api } from "../../api/client";
import { formatAbsoluteDateTime, formatCountdown, formatRelativeTime } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../lib/toast";
import type {
  ApproxLocation,
  EmailAutomationSettings,
  EmailDraft,
  EngagementEvent,
  FollowUpDueStatus,
  FollowUpMessage,
  FollowUpTask,
  Lead,
  LeadActivityEvent,
} from "../../types";

interface EmailHistoryEntry {
  key: string;
  icon: typeof Send;
  tone: "sent" | "reply" | "bad" | "pending" | "stopped" | "delivered" | "opened" | "clicked";
  title: string;
  timestamp: string | null;
  detail?: string;
}

// Best-effort, provider-supplied approximation only — never presented as the
// recipient's exact physical location. Mirrors the server's own caveats
// (engagementPipeline.ts / geoLookup.ts): withheld entirely when no usable
// IP was available, and — critically — withheld entirely (not shown
// alongside a caveat) when the IP belongs to known email/image-proxy
// infrastructure (Gmail's own proxy, Apple Private Relay, etc.), since that
// location describes the proxy's infrastructure, not the recipient. The
// server never sends city/region/country for a `likelyProxied` event, so
// this only needs to render the explicit "unavailable, proxy" message —
// there is nothing partial left to combine it with.
function locationLabel(location: ApproxLocation | null): string {
  if (!location) return "Approximate location: unavailable";
  if (location.likelyProxied) return "Approximate location: unavailable (routed through an email provider proxy)";
  const parts = [location.city, location.region, location.country].filter(Boolean);
  if (parts.length === 0) return "Approximate location: unavailable";
  return `Approximate location: ${parts.join(", ")}`;
}

const ENGAGEMENT_ICON: Record<"delivered" | "opened" | "clicked", typeof Send> = {
  delivered: MailCheck,
  opened: Eye,
  clicked: MousePointerClick,
};

// Turns the raw, possibly-repeated engagementEvents for one sent email into
// at most one timeline entry per type (delivered/opened/clicked), inserted
// right after that email's "sent" entry. Repeat opens/clicks collapse into a
// single "×N" milestone (using the first occurrence's timestamp) instead of
// flooding the timeline — full-fidelity per-event data still lives in
// engagementEvents for the aggregate dashboard metrics.
function buildEngagementEntries(emailId: string | null, keyPrefix: string, events: EngagementEvent[]): EmailHistoryEntry[] {
  if (!emailId) return [];
  const forEmail = events.filter((e) => e.emailId === emailId);
  const entries: EmailHistoryEntry[] = [];

  (["delivered", "opened", "clicked"] as const).forEach((type) => {
    const occurrences = forEmail.filter((e) => e.type === type).sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    if (occurrences.length === 0) return;
    const first = occurrences[0];
    const countSuffix = occurrences.length > 1 ? ` · ×${occurrences.length}` : "";

    if (type === "delivered") {
      entries.push({ key: `${keyPrefix}-delivered`, icon: ENGAGEMENT_ICON.delivered, tone: "delivered", title: "Delivered", timestamp: first.occurredAt });
      return;
    }
    if (type === "opened") {
      entries.push({
        key: `${keyPrefix}-opened`,
        icon: ENGAGEMENT_ICON.opened,
        tone: "opened",
        title: `Opened${countSuffix}`,
        timestamp: first.occurredAt,
        detail: `${locationLabel(first.location)} — an engagement signal, not confirmation the email was read`,
      });
      return;
    }
    const links = [...new Set(occurrences.map((e) => e.clickedLink).filter(Boolean))] as string[];
    entries.push({
      key: `${keyPrefix}-clicked`,
      icon: ENGAGEMENT_ICON.clicked,
      tone: "clicked",
      title: `Link clicked${countSuffix}`,
      timestamp: first.occurredAt,
      detail: [locationLabel(first.location), links.length > 0 ? links.join(", ") : null].filter(Boolean).join(" — "),
    });
  });

  return entries;
}

const ENGAGEMENT_LABEL: Record<string, string> = {
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  not_interested: "Not interested",
};

// Single source of truth for turning the server-computed dueStatus (see
// server/src/automation/followUpEligibility.ts) into display text, so the
// two call sites below (a due task that already exists vs. a not-yet-created
// task whose window has already passed) can never show a different reason
// for what is, from the scheduler's point of view, the exact same gate.
// Falls back to a generic message only if dueStatus hasn't loaded — never
// re-derives the reason itself from settings/lead in the UI.
function followUpDueReasonText(dueStatus: FollowUpDueStatus | null): string {
  if (!dueStatus) return "Waiting for the next automation cycle";
  switch (dueStatus.reason) {
    case "paused":
      return "Automation is paused";
    case "outside_sending_window":
      return "Outside the configured sending window — waiting for the next sending window";
    case "quota_reached":
      return "Daily sending quota reached";
    case "followup_automation_disabled":
      return "Automatic follow-ups are disabled in Settings";
    case "lead_ineligible":
      return dueStatus.message;
    case "waiting_for_delay":
    case "ready":
    default:
      return "Waiting for the next automation cycle";
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function buildTimeline(
  lead: Lead,
  draft: EmailDraft | null,
  tasks: FollowUpTask[],
  messages: FollowUpMessage[],
  activity: LeadActivityEvent[],
  settings: EmailAutomationSettings | null,
  engagementEvents: EngagementEvent[],
  dueStatus: FollowUpDueStatus | null
): EmailHistoryEntry[] {
  const entries: EmailHistoryEntry[] = [];

  if (!draft) {
    return [{ key: "no-draft", icon: Clock3, tone: "pending", title: "No email drafted yet", timestamp: null }];
  }

  // --- Initial email ---
  switch (draft.sendStatus) {
    case "sent":
      entries.push({
        key: "initial",
        icon: Send,
        tone: "sent",
        title: `Initial email sent: "${draft.subject}"`,
        timestamp: draft.sentAt,
      });
      entries.push(...buildEngagementEntries(draft.resendMessageId, "initial", engagementEvents));
      break;
    case "failed":
      entries.push({
        key: "initial",
        icon: XCircle,
        tone: "bad",
        title: "Initial email failed to send",
        timestamp: null,
        detail: draft.sendError ?? undefined,
      });
      return entries; // nothing downstream makes sense without a successful initial send
    case "sending":
      entries.push({ key: "initial", icon: Hourglass, tone: "pending", title: "Initial email is sending…", timestamp: null });
      return entries;
    case "not_sent":
    default:
      entries.push({ key: "initial", icon: Clock3, tone: "pending", title: "Draft ready, not sent yet", timestamp: null });
      return entries;
  }

  // --- Reply / bounce / complaint outcome ---
  const webhookEvent = [...activity]
    .reverse()
    .find((e) => e.type === "webhook_replied" || e.type === "webhook_bounced" || e.type === "webhook_complained");

  if (lead.engagementStatus === "replied") {
    // A distinct location signal from opens/clicks — never overwrites or
    // merges with them. Most recent "received" event wins if there happens
    // to be more than one (only the latest reply is reflected in the
    // Activity feed's webhookEvent lookup above, so this mirrors that).
    const replyEvent = [...engagementEvents]
      .filter((e) => e.type === "received")
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
      .at(-1);
    entries.push({
      key: "reply",
      icon: Reply,
      tone: "reply",
      title: "Reply received",
      timestamp: webhookEvent?.createdAt ?? null,
      detail: locationLabel(replyEvent?.location ?? null),
    });
    return entries; // sequence stops on reply — no follow-up section needed
  }
  if (lead.engagementStatus === "bounced") {
    entries.push({ key: "bounce", icon: MailWarning, tone: "bad", title: "Email bounced", timestamp: webhookEvent?.createdAt ?? null });
    return entries;
  }
  if (lead.engagementStatus === "unsubscribed") {
    entries.push({
      key: "complaint",
      icon: Ban,
      tone: "bad",
      title: "Marked as spam / unsubscribed",
      timestamp: webhookEvent?.createdAt ?? null,
    });
    return entries;
  }
  if (lead.engagementStatus === "not_interested") {
    entries.push({
      key: "not-interested",
      icon: ThumbsDown,
      tone: "stopped",
      title: "Lead marked not interested — sequence stopped",
      timestamp: null,
    });
    return entries;
  }

  // --- Still active: walk the follow-up sequence ---
  entries.push({ key: "awaiting", icon: Reply, tone: "pending", title: "Awaiting reply", timestamp: null });

  if (!draft.sentAt) return entries; // sendStatus "sent" (handled above) always implies sentAt is set

  const followUpCount = settings?.followUpCount ?? 0;
  const delayDays = settings?.followUpDelayDays ?? 3;
  let anchor: string = draft.sentAt;

  for (let seq = 1; seq <= Math.max(followUpCount, tasks.length, messages.length); seq++) {
    const message = messages.find((m) => m.sequenceNumber === seq);
    if (message) {
      entries.push({
        key: `followup-sent-${seq}`,
        icon: Send,
        tone: "sent",
        title: `Follow-up #${seq} sent: "${message.subject}"`,
        timestamp: message.sentAt,
      });
      entries.push(...buildEngagementEntries(message.resendMessageId, `followup-${seq}`, engagementEvents));
      anchor = message.sentAt;
      continue;
    }

    const task = tasks.find((t) => t.sequenceNumber === seq);
    const dueAt = new Date(new Date(anchor).getTime() + delayDays * 86_400_000).toISOString();

    if (task?.status === "cancelled") {
      const reason =
        lead.engagementStatus !== "active"
          ? `Lead is ${ENGAGEMENT_LABEL[lead.engagementStatus] ?? lead.engagementStatus}`
          : !lead.automationEnabled
          ? "Automation was disabled for this lead"
          : "Cancelled";
      entries.push({ key: `followup-cancelled-${seq}`, icon: XCircle, tone: "bad", title: `Follow-up #${seq} not sent`, timestamp: null, detail: reason });
      break;
    }
    if (task?.status === "failed") {
      entries.push({
        key: `followup-failed-${seq}`,
        icon: XCircle,
        tone: "bad",
        title: `Follow-up #${seq} send failed`,
        timestamp: null,
        detail: task.error ?? undefined,
      });
      break;
    }
    if (task?.status === "sending") {
      entries.push({ key: `followup-sending-${seq}`, icon: Hourglass, tone: "pending", title: `Follow-up #${seq} is sending…`, timestamp: null });
      break;
    }
    if (task?.status === "pending" || task?.status === "sent") {
      // "sent" without a matching message would be an inconsistent state; treat as pending/monitoring for display safety.
      const due = new Date(task.scheduledFor);
      if (due.getTime() > Date.now()) {
        entries.push({
          key: `followup-monitor-${seq}`,
          icon: Hourglass,
          tone: "pending",
          title: `Monitoring for reply — follow-up #${seq} scheduled`,
          timestamp: task.scheduledFor,
          detail: "Sends automatically if there's still no reply by then",
        });
      } else {
        entries.push({
          key: `followup-due-${seq}`,
          icon: Hourglass,
          tone: "pending",
          title: `Follow-up #${seq} is due — ${lowerFirst(followUpDueReasonText(dueStatus))}`,
          timestamp: null,
        });
      }
      break;
    }

    // No task exists yet for this sequence.
    if (Date.now() < new Date(dueAt).getTime()) {
      entries.push({
        key: `followup-window-${seq}`,
        icon: Hourglass,
        tone: "pending",
        title: `Monitoring for reply — follow-up #${seq} window`,
        timestamp: dueAt,
        detail: "Sends automatically if there's still no reply by then",
      });
    } else {
      entries.push({
        key: `followup-notsent-${seq}`,
        icon: XCircle,
        tone: "bad",
        title: `Follow-up #${seq} not sent yet`,
        timestamp: null,
        detail: followUpDueReasonText(dueStatus),
      });
    }
    break;
  }

  return entries;
}

const TONE_STYLES: Record<EmailHistoryEntry["tone"], string> = {
  sent: "bg-emerald-50 text-emerald-600",
  reply: "bg-emerald-50 text-emerald-600",
  bad: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-600",
  stopped: "bg-gray-100 text-gray-500",
  delivered: "bg-blue-50 text-blue-600",
  opened: "bg-violet-50 text-violet-600",
  clicked: "bg-indigo-50 text-indigo-600",
};

export function EmailHistoryTimeline({ lead }: { lead: Lead }) {
  const toast = useToast();
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [messages, setMessages] = useState<FollowUpMessage[]>([]);
  const [activity, setActivity] = useState<LeadActivityEvent[]>([]);
  const [engagementEvents, setEngagementEvents] = useState<EngagementEvent[]>([]);
  const [settings, setSettings] = useState<EmailAutomationSettings | null>(null);
  const [dueStatus, setDueStatus] = useState<FollowUpDueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingNow, setSendingNow] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Drives the live countdown shown against a pending follow-up's due time —
  // re-renders every second so the on-screen countdown actually ticks instead
  // of freezing at whatever value it had when this panel was opened.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getEmailDraft(lead.id),
      api.getFollowUpHistory(lead.id),
      api.getLeadActivity(lead.id),
      api.getAutomationSettings(),
      api.listEngagementEvents([lead.id]),
    ])
      .then(([d, followUps, activityEvents, s, engagement]) => {
        if (cancelled) return;
        setDraft(d);
        setTasks(followUps.tasks);
        setMessages(followUps.messages);
        setDueStatus(followUps.dueStatus);
        setActivity(activityEvents);
        setSettings(s);
        setEngagementEvents(engagement);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.engagementStatus]);

  const entries = useMemo(
    () => buildTimeline(lead, draft, tasks, messages, activity, settings, engagementEvents, dueStatus),
    [lead, draft, tasks, messages, activity, settings, engagementEvents, dueStatus]
  );

  const nextPendingTask = useMemo(
    () => tasks.filter((t) => t.status === "pending").sort((a, b) => a.sequenceNumber - b.sequenceNumber)[0] ?? null,
    [tasks]
  );

  async function handleSendNow() {
    setSendingNow(true);
    try {
      // Same route the scheduler itself uses (sendFollowUp) — the task's
      // pending -> sending -> sent transition is what stops the scheduler
      // from ever picking this task up again, so no separate cancellation
      // step is needed here.
      const result = await api.sendFollowUpNow(lead.id);
      setTasks(result.tasks);
      setMessages(result.messages);
      toast.push({ variant: "success", title: "Follow-up sent" });
    } catch (e) {
      toast.push({ variant: "error", title: "Follow-up send failed", description: (e as Error).message });
    } finally {
      setSendingNow(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-xs text-gray-400">Loading…</p>;

  return (
    <div>
      <p className="mb-4 text-[12px] text-gray-400">
        The lifecycle of this lead's email sequence only — initial send, reply/bounce outcome, and follow-ups. General
        lead activity (status changes, edits) is on the Activity tab.
      </p>
      <ol className="relative">
        {entries.map((entry, i) => {
          const Icon = entry.icon;
          const isLast = i === entries.length - 1;
          // Only "pending" tone entries carry a future timestamp (the next
          // follow-up's due time) — everything else with a timestamp is a
          // past event. See buildTimeline: past-event entries are "sent" /
          // "reply" / "bad" tone, so this check reliably distinguishes the
          // countdown case from the exact-time-only case.
          const isCountdown = entry.tone === "pending" && !!entry.timestamp;
          return (
            <li key={entry.key} className="relative flex gap-3 pb-5 last:pb-0">
              {!isLast && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border-subtle" />}
              <span className={cn("relative z-10 flex size-[26px] shrink-0 items-center justify-center rounded-full", TONE_STYLES[entry.tone])}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[13px] text-gray-700">{entry.title}</p>
                {entry.detail && <p className="mt-0.5 text-[12px] text-gray-400">{entry.detail}</p>}
                {entry.timestamp && (
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {formatAbsoluteDateTime(entry.timestamp)}
                    {isCountdown ? (
                      <span className="ml-1.5 font-medium text-amber-600">· due in {formatCountdown(entry.timestamp, now)}</span>
                    ) : (
                      <span className="ml-1.5 text-gray-300">· {formatRelativeTime(entry.timestamp)}</span>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {nextPendingTask && lead.engagementStatus === "active" && (
        <div className="mt-1 flex items-center justify-between rounded-lg border border-border-subtle bg-gray-50/60 px-3 py-2.5">
          <p className="text-[12px] text-gray-500">
            Send follow-up #{nextPendingTask.sequenceNumber} right now instead of waiting for its scheduled time.
          </p>
          <Button size="sm" variant="outline" onClick={handleSendNow} loading={sendingNow} disabled={!lead.email}>
            <Zap className="size-3.5" />
            Send follow-up now
          </Button>
        </div>
      )}
    </div>
  );
}
