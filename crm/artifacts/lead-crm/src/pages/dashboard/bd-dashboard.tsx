import { useState } from "react";
import {
  useGetDashboardStats, getGetDashboardStatsQueryKey, useGetPipelineData,
  useGetRecentActivities, useGetDashboardFollowupsDue, useGetMyDayStats, useListLeads,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Users, Target, CheckCircle2, XCircle, TrendingUp, Calendar, AlertCircle, CalendarDays } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import DateRangeFilter, { useDefaultDateRange, type DateRangeValue } from "@/components/date-range-filter";
import { PipelineStageLinks, stageIdFromBarEvent } from "./pipeline-stage-links";
import {
  StatCard, PremiumTooltip, GradientBar, ActivityFeed,
  FollowUpUrgencyRow, formatCurrency, usePalette,
} from "./dashboard-ui";

const WIN_RATE_TARGET = 25;

function NeuCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[20px] bg-card p-5 ${className}`} style={{ boxShadow: "var(--neuo-shadow)" }}>
      {children}
    </div>
  );
}

export default function BDDashboard() {
  const [, navigate] = useLocation();
  const [dateRange, setDateRange] = useState<DateRangeValue>(useDefaultDateRange());
  const p = usePalette();
  const params = { from: dateRange.from, to: dateRange.to };

  const AXIS_TICK = { fill: p.TEXT_SECONDARY, fontSize: 11 };
  const GRID_PROPS = { strokeDasharray: "3 3" as const, vertical: false as const, stroke: p.GRID_COLOR, strokeOpacity: 0.6 };

  const buildLeadsUrl = (extra: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    if (dateRange.from) qs.set("dateFrom", dateRange.from);
    if (dateRange.to) qs.set("dateTo", dateRange.to);
    for (const [k, v] of Object.entries(extra)) { if (v != null) qs.set(k, v); }
    const s = qs.toString();
    return s ? `/leads?${s}` : "/leads";
  };

  const { data: stats, isLoading: loadingStats } = useGetDashboardStats(params, {
    query: { queryKey: getGetDashboardStatsQueryKey(params), refetchInterval: 60_000 },
  });
  const { data: pipeline, isLoading: loadingPipeline } = useGetPipelineData(params);
  const { data: activities, isLoading: loadingActivities } = useGetRecentActivities({ limit: 6, from: dateRange.from, to: dateRange.to });
  const { data: followupsDue, isLoading: loadingFollowups } = useGetDashboardFollowupsDue(params);
  const { data: myDay, isLoading: loadingMyDay } = useGetMyDayStats();
  const { data: myLeads, isLoading: loadingLeads } = useListLeads({ limit: 8 });

  const winRate = stats?.conversionRate ?? 0;
  const winRatePct = Math.min((winRate / WIN_RATE_TARGET) * 100, 100);
  const atTarget = winRate >= WIN_RATE_TARGET;
  const barColor = atTarget ? p.ACCENT : winRate >= WIN_RATE_TARGET * 0.75 ? p.SECONDARY : p.NEGATIVE;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: p.TEXT_PRIMARY }}>My Dashboard</h1>
          <p className="text-sm" style={{ color: p.TEXT_SECONDARY }}>Your personal pipeline at a glance</p>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard title="My Leads" value={stats?.totalLeads ?? 0} icon={Users} description="Total assigned" loading={loadingStats} onClick={() => navigate(buildLeadsUrl())} />
        <StatCard title="Avg Deal Size" value={stats?.avgDealSize ? formatCurrency(stats.avgDealSize) : "—"} icon={TrendingUp} description="Per closed deal" loading={loadingStats} />
        <StatCard title="Active" value={stats?.activeLeads ?? 0} icon={TrendingUp} description="In pipeline" loading={loadingStats} onClick={() => navigate(buildLeadsUrl({ status: "active" }))} />
        <StatCard title="Follow-ups Due" value={stats?.followupsDue ?? 0} icon={Calendar} description="Pending actions" loading={loadingStats} onClick={() => navigate(buildLeadsUrl())} />
      </div>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard title="Won" value={stats?.wonLeads ?? 0} icon={CheckCircle2} description="Closed won" loading={loadingStats} highlight={p.ACCENT} onClick={() => navigate("/deals?stage=won")} />
        <StatCard title="Lost" value={stats?.lostLeads ?? 0} icon={XCircle} description="Closed lost" loading={loadingStats} highlight={p.NEGATIVE} onClick={() => navigate("/deals?stage=lost")} />
        <StatCard title="New Leads" value={stats?.newLeads ?? 0} icon={TrendingUp} description="First stage" loading={loadingStats} onClick={() => navigate(buildLeadsUrl({ status: "active" }))} />
        <StatCard title="Win Rate" value={`${winRate.toFixed(1)}%`} icon={Target} description="Conversion" loading={loadingStats} />
      </div>

      {/* Win Rate vs Target */}
      {!loadingStats && stats && (
        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "12px" }}>Win Rate vs Target</p>
          <div className="flex items-end justify-between mb-3">
            <div>
              <span style={{ fontSize: "2.5rem", fontWeight: 700, color: atTarget ? p.ACCENT : p.TEXT_PRIMARY, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {winRate.toFixed(1)}%
              </span>
              <span className="text-sm ml-2" style={{ color: p.TEXT_SECONDARY }}>current win rate</span>
            </div>
            <span className="text-xs font-medium" style={{ color: p.TEXT_SECONDARY }}>Target: {WIN_RATE_TARGET}%</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: p.TRACK_BG }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${winRatePct}%`, background: barColor }} />
          </div>
          <p className="text-xs mt-2" style={{ color: p.TEXT_SECONDARY }}>
            {atTarget
              ? `✓ ${(winRate - WIN_RATE_TARGET).toFixed(1)}% above target`
              : `${(WIN_RATE_TARGET - winRate).toFixed(1)}% below target — ${Math.max(0, Math.ceil(WIN_RATE_TARGET / 100 * (stats.totalLeads ?? 0)) - (stats.wonLeads ?? 0))} more wins needed`}
          </p>
        </NeuCard>
      )}

      {/* My Day Widget */}
      <NeuCard>
        <div className="flex items-center justify-between mb-4">
          <span style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY }}>
            <CalendarDays className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />
            My Day
            <span className="ml-1.5 text-xs font-normal" style={{ color: p.TEXT_SECONDARY }}>(today)</span>
          </span>
          <Link href="/activities" className="text-xs hover:opacity-75 transition-opacity" style={{ color: p.ACCENT }}>View calendar →</Link>
        </div>
        {loadingMyDay ? (
          <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-[14px]" />)}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { value: myDay?.todayTotal ?? 0, label: "Today's Activities", bg: p.ACCENT_BG, color: p.TEXT_PRIMARY },
              { value: myDay?.todayCompleted ?? 0, label: "Completed", bg: p.TODAY_BG, color: p.ACCENT },
              {
                value: myDay?.todayOverdue ?? 0, label: "Overdue",
                bg: (myDay?.todayOverdue ?? 0) > 0 ? p.OVERDUE_BG : p.ACCENT_BG,
                color: (myDay?.todayOverdue ?? 0) > 0 ? p.NEGATIVE : p.TEXT_PRIMARY,
                showIcon: (myDay?.todayOverdue ?? 0) > 0,
              },
              { value: `${myDay?.weekCompleted ?? 0}/${myDay?.weekTotal ?? 0}`, label: "This Week", bg: p.ACCENT_BG, color: p.SECONDARY },
            ].map(({ value, label, bg, color, showIcon }) => (
              <div key={label} className="text-center rounded-[14px] p-3" style={{ background: bg }}>
                <p className="text-2xl font-bold tabular-nums" style={{ color }}>
                  {showIcon && <AlertCircle className="h-4 w-4 inline mr-1 mb-0.5" style={{ color: p.NEGATIVE }} />}
                  {value}
                </p>
                <p className="text-[11px] mt-1" style={{ color: p.TEXT_SECONDARY }}>{label}</p>
              </div>
            ))}
          </div>
        )}
      </NeuCard>

      {/* Follow-ups + Pipeline */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-7">
        <NeuCard className="col-span-3">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Calendar className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />My Follow-ups
          </p>
          {loadingFollowups ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : followupsDue ? (
            <>
              <FollowUpUrgencyRow
                overdue={followupsDue.overdue} dueToday={followupsDue.dueToday} dueThisWeek={followupsDue.dueThisWeek}
                onOverdueClick={() => navigate(buildLeadsUrl({ followupDue: "overdue" }))}
                onTodayClick={() => navigate(buildLeadsUrl({ followupDue: "today" }))}
                onWeekClick={() => navigate(buildLeadsUrl({ followupDue: "week" }))}
              />
              {followupsDue.items.length === 0 ? (
                <p className="text-center text-sm py-4" style={{ color: p.TEXT_SECONDARY }}>No follow-ups due. Keep it up!</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {followupsDue.items.slice(0, 8).map(f => (
                    <Link key={f.id} href={`/leads/${f.leadId}`}>
                      <div className="flex items-center gap-2 rounded-[12px] px-2.5 py-2 cursor-pointer transition-all duration-150 hover:opacity-80"
                        style={{ background: p.ACCENT_BG }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: p.TEXT_PRIMARY }}>{f.leadCompanyName}</p>
                          {f.notes && <p className="text-xs truncate" style={{ color: p.TEXT_SECONDARY }}>{f.notes}</p>}
                        </div>
                        <span className="text-xs shrink-0 font-medium"
                          style={{ color: new Date(f.scheduledAt) < new Date() ? p.NEGATIVE : p.TEXT_SECONDARY }}>
                          {format(parseISO(f.scheduledAt), "MMM d")}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </NeuCard>

        <NeuCard className="col-span-4">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>My Pipeline</p>
          {loadingPipeline ? <Skeleton className="h-[220px] w-full" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipeline ?? []} margin={{ top: 6, right: 16, left: 0, bottom: 4 }} barCategoryGap="35%">
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="stageName" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <RechartsTooltip content={<PremiumTooltip />} cursor={{ fill: p.ACCENT_BG }} />
                <Bar dataKey="count" name="Leads" shape={(props: any) => <GradientBar {...props} />}
                  cursor="pointer" onClick={(data: any) => {
                    const stageId = stageIdFromBarEvent(data);
                    if (stageId) navigate(buildLeadsUrl({ stageId: String(stageId) }));
                  }} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <PipelineStageLinks stages={pipeline ?? []} onSelect={stageId => navigate(buildLeadsUrl({ stageId: String(stageId) }))} />
        </NeuCard>
      </div>

      {/* My Active Leads + Activity */}
      <div className="grid gap-5 md:grid-cols-2">
        <NeuCard>
          <div className="flex items-center justify-between mb-4">
            <span style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY }}>My Active Leads</span>
            <Link href="/leads" className="text-xs hover:opacity-75 transition-opacity" style={{ color: p.ACCENT }}>View all →</Link>
          </div>
          {loadingLeads ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-[12px]" />)}</div>
          ) : !myLeads?.leads || myLeads.leads.length === 0 ? (
            <p className="text-center text-sm py-6" style={{ color: p.TEXT_SECONDARY }}>No leads assigned yet.</p>
          ) : (
            <div className="space-y-1">
              {myLeads.leads.slice(0, 6).map(lead => (
                <Link key={lead.id} href={`/leads/${lead.id}`}>
                  <div className="flex items-center gap-3 rounded-[12px] px-2.5 py-2 cursor-pointer transition-all duration-150 hover:opacity-80"
                    style={{ background: p.ACCENT_BG }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: p.TEXT_PRIMARY }}>{lead.companyName}</p>
                      <p className="text-xs truncate" style={{ color: p.TEXT_SECONDARY }}>{lead.contactPerson}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {lead.priority && (
                        <span className="text-xs rounded-full px-2 py-0.5 font-medium capitalize"
                          style={{
                            background: lead.priority === "hot" ? p.OVERDUE_BG : p.ACCENT_BG,
                            color: lead.priority === "hot" ? p.NEGATIVE : p.ACCENT,
                          }}>
                          {lead.priority}
                        </span>
                      )}
                      {lead.nextFollowUpAt && (
                        <span className="text-xs" style={{ color: new Date(lead.nextFollowUpAt) < new Date() ? p.NEGATIVE : p.TEXT_SECONDARY }}>
                          {format(parseISO(lead.nextFollowUpAt), "MMM d")}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </NeuCard>

        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>Recent Activity</p>
          {loadingActivities ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <ActivityFeed items={activities ?? []} onLeadClick={leadId => navigate(`/leads/${leadId}`)} />
          )}
        </NeuCard>
      </div>
    </div>
  );
}
