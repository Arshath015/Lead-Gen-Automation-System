import { useEffect, useState } from "react";
import {
  UserPlus,
  ArrowRightLeft,
  Heart,
  Bot,
  KeyRound,
  Sparkles,
  AlertTriangle,
  PenLine,
  Send,
  XCircle,
  MailWarning,
  Reply,
  Ban,
  MailCheck,
  Eye,
  MousePointerClick,
  Building2,
} from "lucide-react";
import { api } from "../../api/client";
import { formatAbsoluteDateTime, formatRelativeTime } from "../../lib/format";
import type { LeadActivityEvent, LeadActivityType } from "../../types";

const ICONS: Record<LeadActivityType, typeof UserPlus> = {
  lead_created: UserPlus,
  status_changed: ArrowRightLeft,
  engagement_changed: Heart,
  automation_toggled: Bot,
  email_revealed: KeyRound,
  research_completed: Sparkles,
  research_failed: AlertTriangle,
  draft_generated: PenLine,
  draft_edited: PenLine,
  email_sent: Send,
  email_send_failed: XCircle,
  follow_up_sent: Send,
  sent_to_crm: Building2,
  webhook_replied: Reply,
  webhook_bounced: MailWarning,
  webhook_complained: Ban,
  webhook_delivered: MailCheck,
  webhook_opened: Eye,
  webhook_clicked: MousePointerClick,
};

const TONES: Record<LeadActivityType, string> = {
  lead_created: "bg-gray-100 text-gray-500",
  status_changed: "bg-gray-100 text-gray-500",
  engagement_changed: "bg-gray-100 text-gray-500",
  automation_toggled: "bg-gray-100 text-gray-500",
  email_revealed: "bg-accent-50 text-accent-600",
  research_completed: "bg-accent-50 text-accent-600",
  research_failed: "bg-red-50 text-red-600",
  draft_generated: "bg-accent-50 text-accent-600",
  draft_edited: "bg-accent-50 text-accent-600",
  email_sent: "bg-emerald-50 text-emerald-600",
  email_send_failed: "bg-red-50 text-red-600",
  follow_up_sent: "bg-emerald-50 text-emerald-600",
  sent_to_crm: "bg-purple-50 text-purple-600",
  webhook_replied: "bg-emerald-50 text-emerald-600",
  webhook_bounced: "bg-red-50 text-red-600",
  webhook_complained: "bg-red-50 text-red-600",
  webhook_delivered: "bg-blue-50 text-blue-600",
  webhook_opened: "bg-violet-50 text-violet-600",
  webhook_clicked: "bg-indigo-50 text-indigo-600",
};

export function ActivityTimeline({ leadId }: { leadId: string }) {
  const [events, setEvents] = useState<LeadActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    api
      .getLeadActivity(leadId)
      .then((data) => {
        if (!cancelled) setEvents([...data].reverse()); // newest first
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (error) {
    return <p className="py-8 text-center text-xs text-red-500">{error}</p>;
  }

  if (!events) {
    return <p className="py-8 text-center text-xs text-gray-400">Loading…</p>;
  }

  if (events.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-[13px] font-medium text-ink">No activity recorded yet</p>
        <p className="mx-auto mt-1 max-w-[220px] text-[12px] text-gray-400">
          Actions on this lead — research, drafts, sends, replies — will appear here as they happen.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative">
      {events.map((event, i) => {
        const Icon = ICONS[event.type] ?? ArrowRightLeft;
        const isLast = i === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border-subtle" />}
            <span className={`relative z-10 flex size-[26px] shrink-0 items-center justify-center rounded-full ${TONES[event.type]}`}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] text-gray-700">{event.summary}</p>
              <p className="mt-0.5 text-[11px] text-gray-400" title={formatAbsoluteDateTime(event.createdAt)}>
                {formatRelativeTime(event.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
