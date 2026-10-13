import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Mail,
  PenLine,
  Send,
  Clock,
  CircleDot,
  CheckCircle2,
  XCircle,
  Search,
  Circle,
  Reply,
  MailWarning,
  Ban,
  ThumbsDown,
  MailCheck,
  Eye,
  MousePointerClick,
  Info,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { KpiCard } from "../../components/ui/KpiCard";
import { DetailCard, DetailRow } from "../../components/ui/DetailCard";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Avatar } from "../../components/ui/Avatar";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatTile } from "../../components/ui/StatTile";
import { PipelineFunnel } from "./PipelineFunnel";
import { buildActivity } from "./activity";
import { useLeadsData, MAX_LEADS_PAGE_SIZE } from "../leads/useLeadsData";
import { formatRelativeTime } from "../../lib/format";
import { api } from "../../api/client";
import type { EngagementSummary } from "../../types";

type Range = "all" | "today" | "week" | "month";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

function withinRange(iso: string, range: Range): boolean {
  if (range === "all") return true;
  const date = new Date(iso);
  const now = new Date();
  if (range === "today") return date.toDateString() === now.toDateString();
  if (range === "week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    return date >= weekAgo;
  }
  const monthAgo = new Date(now);
  monthAgo.setMonth(now.getMonth() - 1);
  return date >= monthAgo;
}

export function DashboardPage() {
  // Unlike the Leads list page, the dashboard computes aggregate stats
  // (totals, qualification/engagement breakdowns, pipeline funnel, recent
  // activity) over the whole table, not a row-per-lead view — so it asks
  // for the largest page the server will give out (MAX_LEADS_PAGE_SIZE),
  // not the list view's smaller default page.
  const { leads, briefsByLead, draftsByLead, loading, error, reload } = useLeadsData({ initialPageSize: MAX_LEADS_PAGE_SIZE });
  const [range, setRange] = useState<Range>("all");

  const scoped = useMemo(() => leads.filter((l) => withinRange(l.createdAt, range)), [leads, range]);

  // Aggregate engagement metrics (Email Engagement Analytics) — entirely
  // driven by real webhook-derived events server-side, scoped to the same
  // range-filtered lead set as every other KPI on this page. Re-fetched
  // whenever the visible lead set changes (range switch, new leads loaded).
  const [engagementSummary, setEngagementSummary] = useState<EngagementSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (scoped.length === 0) {
      setEngagementSummary(null);
      return;
    }
    api
      .getEngagementSummary(scoped.map((l) => l.id))
      .then((s) => !cancelled && setEngagementSummary(s))
      .catch(() => !cancelled && setEngagementSummary(null));
    return () => {
      cancelled = true;
    };
  }, [scoped]);

  const kpis = useMemo(() => {
    const briefs = scoped.map((l) => briefsByLead[l.id]).filter(Boolean);
    const drafts = scoped.map((l) => draftsByLead[l.id]).filter(Boolean);
    return {
      total: scoped.length,
      new: scoped.filter((l) => l.status === "new").length,
      qualified: scoped.filter((l) => l.status === "qualified").length,
      rejected: scoped.filter((l) => l.status === "rejected").length,
      revealed: scoped.filter((l) => l.email).length,
      researched: briefs.filter((b) => b.status === "complete").length,
      researchFailed: briefs.filter((b) => b.status === "failed").length,
      drafted: drafts.length,
      sent: drafts.filter((d) => d.sendStatus === "sent").length,
      replied: scoped.filter((l) => l.engagementStatus === "replied").length,
      bounced: scoped.filter((l) => l.engagementStatus === "bounced").length,
      unsubscribed: scoped.filter((l) => l.engagementStatus === "unsubscribed").length,
      notInterested: scoped.filter((l) => l.engagementStatus === "not_interested").length,
    };
  }, [scoped, briefsByLead, draftsByLead]);

  const activity = useMemo(() => buildActivity(scoped, briefsByLead, draftsByLead).slice(0, 8), [scoped, briefsByLead, draftsByLead]);

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader
        title="Dashboard"
        description="Overview of your outreach pipeline and recent activity."
        actions={<SegmentedControl value={range} onChange={setRange} options={RANGE_OPTIONS} />}
      />

      <div className="px-6 pb-10">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
            <button onClick={reload} className="font-medium underline">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
            <p className="text-[14px] font-medium text-ink">No pipeline data yet</p>
            <p className="mt-1 max-w-sm text-[13px] text-gray-500">
              Go to Leads and use "Find leads" to pull your first batch from Apollo — your dashboard will populate automatically.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KpiCard
                label="Total leads"
                value={kpis.total}
                caption="100% of total"
                icon={<Users className="size-5" />}
                chipClassName="bg-violet-50 text-violet-600"
              />
              <KpiCard
                label="Emails revealed"
                value={kpis.revealed}
                caption={`${pct(kpis.revealed, kpis.total)}% of total`}
                icon={<Mail className="size-5" />}
                chipClassName="bg-blue-50 text-blue-600"
              />
              <KpiCard
                label="Drafts written"
                value={kpis.drafted}
                caption={`${pct(kpis.drafted, kpis.total)}% of total`}
                icon={<PenLine className="size-5" />}
                chipClassName="bg-emerald-50 text-emerald-600"
              />
              <KpiCard
                label="Emails sent"
                value={kpis.sent}
                caption={`${pct(kpis.sent, kpis.total)}% of total`}
                icon={<Send className="size-5" />}
                chipClassName="bg-indigo-50 text-indigo-600"
              />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <DetailCard title="Qualification">
                <DetailRow icon={<CircleDot className="size-3.5" />} iconClassName="bg-blue-50 text-blue-600" label="New" value={kpis.new} />
                <DetailRow icon={<CheckCircle2 className="size-3.5" />} iconClassName="bg-emerald-50 text-emerald-600" label="Qualified" value={kpis.qualified} />
                <DetailRow icon={<XCircle className="size-3.5" />} iconClassName="bg-red-50 text-red-600" label="Rejected" value={kpis.rejected} />
                <DetailRow icon={<Search className="size-3.5" />} iconClassName="bg-amber-50 text-amber-600" label="Researched" value={kpis.researched} />
                <DetailRow icon={<Circle className="size-3.5" />} iconClassName="bg-gray-100 text-gray-500" label="Research failed" value={kpis.researchFailed} />
              </DetailCard>

              <DetailCard title="Engagement">
                <DetailRow icon={<Reply className="size-3.5" />} iconClassName="bg-blue-50 text-blue-600" label="Replied" value={kpis.replied} />
                <DetailRow icon={<MailWarning className="size-3.5" />} iconClassName="bg-red-50 text-red-600" label="Bounced" value={kpis.bounced} />
                <DetailRow icon={<Ban className="size-3.5" />} iconClassName="bg-red-50 text-red-600" label="Unsubscribed" value={kpis.unsubscribed} />
                <DetailRow icon={<ThumbsDown className="size-3.5" />} iconClassName="bg-gray-100 text-gray-500" label="Not interested" value={kpis.notInterested} />
              </DetailCard>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
              <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card lg:col-span-3">
                <h3 className="text-[15px] font-bold text-ink">Pipeline funnel</h3>
                <p className="mb-5 text-[13px] text-gray-500">How leads move from found to sent</p>
                <PipelineFunnel
                  rows={[
                    { label: "Found", count: kpis.total },
                    { label: "Email revealed", count: kpis.revealed },
                    { label: "Researched", count: kpis.researched },
                    { label: "Drafted", count: kpis.drafted },
                    { label: "Sent", count: kpis.sent },
                  ]}
                />
              </div>

              <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card lg:col-span-2">
                <div className="mb-3 flex items-center gap-1.5">
                  <Clock className="size-3.5 text-gray-400" />
                  <h3 className="text-[15px] font-bold text-ink">Recent activity</h3>
                </div>
                {activity.length === 0 ? (
                  <p className="py-6 text-center text-xs text-gray-400">Nothing in this range yet.</p>
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {activity.map((event) => (
                      <div key={event.id + event.at} className="flex items-start gap-2.5 py-2.5 first:pt-0">
                        <Avatar name={event.leadName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] text-gray-700">
                            <span className="font-medium text-ink">{event.leadName}</span> {event.text}
                          </p>
                          <p className="text-[11px] text-gray-400">{formatRelativeTime(event.at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[15px] font-bold text-ink">Email engagement</h3>
                  <p className="text-[13px] text-gray-500">
                    Automatic, from real Resend delivery events — not editable. Based on {engagementSummary?.sentCount ?? 0} email
                    {engagementSummary?.sentCount === 1 ? "" : "s"} sent in this range.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatTile
                  label="Delivery rate"
                  value={`${engagementSummary?.deliveryRate ?? 0}%`}
                  tone="default"
                />
                <StatTile label="Open rate" value={`${engagementSummary?.openRate ?? 0}%`} tone="accent" />
                <StatTile label="Click rate" value={`${engagementSummary?.clickRate ?? 0}%`} tone="accent" />
                <StatTile label="Reply rate" value={`${engagementSummary?.replyRate ?? 0}%`} tone="default" />
                <StatTile label="Bounce rate" value={`${engagementSummary?.bounceRate ?? 0}%`} tone="warn" />
                <StatTile label="Complaint rate" value={`${engagementSummary?.complaintRate ?? 0}%`} tone="warn" />
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5">
                <Info className="mt-0.5 size-3.5 shrink-0 text-gray-400" />
                <p className="text-[11.5px] text-gray-500">
                  "Opened" reflects an engagement signal from the recipient's mail client (e.g. loading a tracking
                  pixel) — it is not proof the email was actually read, and some clients (notably Apple Mail Privacy
                  Protection) pre-fetch it automatically regardless of whether a person opened the message.
                </p>
              </div>

              {engagementSummary && engagementSummary.sentCount > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
                  <MiniStat icon={MailCheck} label="Delivered" value={engagementSummary.deliveredCount} />
                  <MiniStat icon={Eye} label="Opened" value={engagementSummary.openedCount} />
                  <MiniStat icon={MousePointerClick} label="Clicked" value={engagementSummary.clickedCount} />
                  <MiniStat icon={Reply} label="Replied" value={engagementSummary.repliedCount} />
                  <MiniStat icon={MailWarning} label="Bounced" value={engagementSummary.bouncedCount} />
                  <MiniStat icon={Ban} label="Complained" value={engagementSummary.complainedCount} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Reply; label: string; value: number }) {
  return (
    <div>
      <div className="mx-auto flex size-7 items-center justify-center rounded-full bg-gray-50 text-gray-400">
        <Icon className="size-3.5" />
      </div>
      <p className="mt-1 text-[13px] font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[10.5px] text-gray-400">{label}</p>
    </div>
  );
}
