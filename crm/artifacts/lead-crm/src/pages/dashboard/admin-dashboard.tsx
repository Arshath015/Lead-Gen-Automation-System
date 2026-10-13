import { useState } from "react";
import {
  useGetDashboardStats, getGetDashboardStatsQueryKey,
  useGetPipelineData, useGetConversionFunnel,
  useGetRecentActivities, useGetDashboardLeaderboard, useGetDashboardDataHealth,
  useGetDashboardFollowupsDue,
  useGetDealsByStage, useGetRevenueOverTime,
} from "@workspace/api-client-react";
import {
  useGetLeadsByIndustry, useGetLeadsByLocation, useGetMonthlyGrowth, useGetLeadsByStatus,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Sector, Cell, AreaChart, Area,
} from "recharts";
import { Users, Target, CheckCircle2, XCircle, TrendingUp, Calendar, Layers, AlertTriangle, Trophy, MapPin, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import DateRangeFilter, { useDefaultDateRange, type DateRangeValue } from "@/components/date-range-filter";
import { PipelineStageLinks, stageIdFromBarEvent } from "./pipeline-stage-links";
import {
  StatCard, PremiumTooltip, GradientBar, LeaderboardList,
  ActivityFeed, FollowUpUrgencyRow, formatCurrency, usePalette,
} from "./dashboard-ui";

function NeuCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const p = usePalette();
  return (
    <div
      className={`rounded-[20px] p-5 ${className}`}
      style={{ boxShadow: "var(--neuo-shadow)", backgroundColor: p.CARD_BG }}
    >
      {children}
    </div>
  );
}

function renderActiveDonutShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector cx={cx} cy={cy} innerRadius={innerRadius - 3} outerRadius={outerRadius + 6}
      startAngle={startAngle} endAngle={endAngle} fill={fill} />
  );
}

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const [dateRange, setDateRange] = useState<DateRangeValue>(useDefaultDateRange());
  const [activeIndustryIdx, setActiveIndustryIdx] = useState<number | undefined>();
  const p = usePalette();
  const params = { from: dateRange.from, to: dateRange.to };

  const AXIS_TICK = { fill: p.TEXT_SECONDARY, fontSize: 11 };
  const GRID_PROPS = { strokeDasharray: "3 3" as const, vertical: false as const, stroke: p.GRID_COLOR, strokeOpacity: 0.6 };

  const { data: stats, isLoading: loadingStats } = useGetDashboardStats(params, {
    query: { queryKey: getGetDashboardStatsQueryKey(params), refetchInterval: 60_000 },
  });
  const { data: pipeline, isLoading: loadingPipeline } = useGetPipelineData(params);
  const { data: funnel, isLoading: loadingFunnel } = useGetConversionFunnel(params);
  const { data: activities, isLoading: loadingActivities } = useGetRecentActivities({ limit: 8, from: dateRange.from, to: dateRange.to });
  const { data: leaderboard, isLoading: loadingLeaderboard } = useGetDashboardLeaderboard(params);
  const { data: dataHealth, isLoading: loadingHealth } = useGetDashboardDataHealth();
  const { data: followupsDue, isLoading: loadingFollowups } = useGetDashboardFollowupsDue(params);
  const { data: byIndustry } = useGetLeadsByIndustry({ dateFrom: dateRange.from, dateTo: dateRange.to });
  const { data: byLocation } = useGetLeadsByLocation({ from: dateRange.from, to: dateRange.to });
  const { data: bySource } = useGetLeadsByStatus();
  const { data: monthlyGrowth } = useGetMonthlyGrowth({ months: 6, from: dateRange.from, to: dateRange.to });
  const { data: dealsByStage, isLoading: loadingDealsByStage } = useGetDealsByStage();
  const { data: revenueOverTime, isLoading: loadingRevenue } = useGetRevenueOverTime();

  const buildLeadsUrl = (extra: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    if (dateRange.from) qs.set("dateFrom", dateRange.from);
    if (dateRange.to) qs.set("dateTo", dateRange.to);
    for (const [k, v] of Object.entries(extra)) { if (v != null) qs.set(k, v); }
    const s = qs.toString();
    return s ? `/leads?${s}` : "/leads";
  };

  const industryTotal = (byIndustry ?? []).slice(0, 8).reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: p.TEXT_PRIMARY }}>Admin Dashboard</h1>
          <p className="text-sm" style={{ color: p.TEXT_SECONDARY }}>Organisation-wide pipeline overview</p>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Primary KPI row */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        <StatCard title="Total Leads" value={stats?.totalLeads ?? 0} icon={Layers} description="All leads in CRM" loading={loadingStats} glow onClick={() => navigate(buildLeadsUrl())} />
        <StatCard title="Won" value={stats?.wonLeads ?? 0} icon={CheckCircle2} description="Leads closed won" loading={loadingStats} glow onClick={() => navigate(buildLeadsUrl({ status: "won" }))} />
        <StatCard title="Conversion" value={`${(stats?.conversionRate ?? 0).toFixed(1)}%`} icon={Target} description="Win rate" loading={loadingStats} />
      </div>

      {/* Secondary KPI row */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard title="New Leads" value={stats?.newLeads ?? 0} icon={TrendingUp} description="In first stage" loading={loadingStats} glow onClick={() => navigate(buildLeadsUrl({ status: "active" }))} />
        <StatCard title="Active" value={stats?.activeLeads ?? 0} icon={Users} description="In pipeline" loading={loadingStats} onClick={() => navigate(buildLeadsUrl({ status: "active" }))} />
        <StatCard title="Lost" value={stats?.lostLeads ?? 0} icon={XCircle} description="Leads closed lost" loading={loadingStats} highlight={p.NEGATIVE} onClick={() => navigate(buildLeadsUrl({ status: "lost" }))} />
        <StatCard title="Avg Deal Size" value={stats?.avgDealSize ? formatCurrency(stats.avgDealSize) : "—"} icon={TrendingUp} description="Per closed lead" loading={loadingStats} />
      </div>

      {/* Data Health — neumorphic card */}
      {!loadingHealth && dataHealth && (dataHealth.unassigned > 0 || dataHealth.stale > 0) && (
        <NeuCard>
          <div className="flex items-start gap-3">
            <div className="rounded-xl p-2 mt-0.5 shrink-0" style={{ background: p.ACCENT_BG }}>
              <AlertTriangle className="h-4 w-4" style={{ color: p.ACCENT, opacity: 0.75 }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold mb-2" style={{ color: p.TEXT_PRIMARY }}>Data Health Issues</p>
              <div className="flex flex-wrap gap-2">
                {dataHealth.unassigned > 0 && (
                  <button
                    className="text-xs rounded-full px-3 py-1 font-medium transition-opacity hover:opacity-75"
                    style={{ background: p.ACCENT_BG, color: p.ACCENT }}
                    onClick={() => navigate(buildLeadsUrl({ unassigned: "true" }))}
                  >
                    {dataHealth.unassigned} unassigned →
                  </button>
                )}
                {dataHealth.stale > 0 && (
                  <button
                    className="text-xs rounded-full px-3 py-1 font-medium transition-opacity hover:opacity-75"
                    style={{ background: p.ACCENT_BG, color: p.ACCENT }}
                    onClick={() => navigate(buildLeadsUrl({ stale: "true" }))}
                  >
                    {dataHealth.stale} stale (30+ days) →
                  </button>
                )}
                {dataHealth.missingEmail > 0 && (
                  <button
                    className="text-xs rounded-full px-3 py-1 font-medium transition-opacity hover:opacity-75"
                    style={{ background: p.ACCENT_BG, color: p.ACCENT }}
                    onClick={() => navigate(buildLeadsUrl({ missing: "email" }))}
                  >
                    {dataHealth.missingEmail} missing email →
                  </button>
                )}
                {dataHealth.missingValue > 0 && (
                  <button
                    className="text-xs rounded-full px-3 py-1 font-medium transition-opacity hover:opacity-75"
                    style={{ background: p.ACCENT_BG, color: p.ACCENT }}
                    onClick={() => navigate(buildLeadsUrl({ missing: "dealValue" }))}
                  >
                    {dataHealth.missingValue} missing deal value →
                  </button>
                )}
              </div>
            </div>
          </div>
        </NeuCard>
      )}

      {/* ── Section label: Lead Pipeline ─────────────────────────────────── */}
      <div className="flex items-center gap-2.5 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: p.TEXT_SECONDARY }}>Lead Pipeline</span>
        <div className="flex-1 border-b" style={{ borderColor: `${p.GRID_COLOR}80` }} />
      </div>

      {/* Pipeline BarChart + Funnel */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-7">
        <NeuCard className="col-span-4">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>Pipeline by Stage</p>
          {loadingPipeline ? <Skeleton className="h-[240px] w-full" /> : (
            <ResponsiveContainer width="100%" height={240}>
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

        <NeuCard className="col-span-3">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>Conversion Funnel</p>
          {loadingFunnel ? <Skeleton className="h-[240px] w-full" /> : (
            <div className="space-y-3">
              {(funnel ?? []).map((step, i) => (
                <div
                  key={step.stage}
                  className="space-y-1.5 cursor-pointer rounded-[12px] px-2 py-1.5 -mx-2 transition-all duration-150 hover:opacity-80"
                  onClick={() => navigate(buildLeadsUrl({ stageId: String((step as any).stageId) }))}
                >
                  <div className="flex justify-between text-xs">
                    <span className="font-medium" style={{ color: p.TEXT_PRIMARY }}>{step.stage}</span>
                    <span className="tabular-nums" style={{ color: p.TEXT_SECONDARY }}>{step.count} <span style={{ opacity: 0.55 }}>({step.percentage}%)</span></span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: p.TRACK_BG }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${step.percentage}%`, background: p.CHART_COLORS[i % p.CHART_COLORS.length] }} />
                  </div>
                </div>
              ))}
              {(!funnel || funnel.length === 0) && (
                <p className="text-center text-sm py-8" style={{ color: p.TEXT_SECONDARY }}>No funnel data yet.</p>
              )}
            </div>
          )}
        </NeuCard>
      </div>

      {/* Monthly Growth + Industry Donut */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-7">
        <NeuCard className="col-span-4">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>Monthly Lead Growth</p>
          {!monthlyGrowth ? <Skeleton className="h-[200px] w-full" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyGrowth} margin={{ top: 6, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey={(row: { month: string; year: number }) => `${row.month} ${row.year}`} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <RechartsTooltip content={<PremiumTooltip />} cursor={{ stroke: p.GRID_COLOR }} />
                <Area type="monotone" dataKey="created" name="Created"
                  stroke={p.CHART_COLORS[2]} strokeWidth={2.5}
                  fill={p.CHART_COLORS[2]} fillOpacity={0.12}
                  dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: p.CHART_COLORS[2] }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </NeuCard>

        <NeuCard className="col-span-3">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>Leads by Industry</p>
          {!byIndustry ? <Skeleton className="h-[200px] w-full" /> : byIndustry.length === 0 ? (
            <p className="text-center text-sm py-8" style={{ color: p.TEXT_SECONDARY }}>No industry data yet.</p>
          ) : (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={byIndustry.slice(0, 8)} dataKey="count" nameKey="name"
                      cx="50%" cy="50%" innerRadius={52} outerRadius={76}
                      activeIndex={activeIndustryIdx}
                      activeShape={renderActiveDonutShape}
                      onMouseEnter={(_, i) => setActiveIndustryIdx(i)}
                      onMouseLeave={() => setActiveIndustryIdx(undefined)}
                      cursor="pointer"
                      onClick={(data: any) => navigate(`/leads?industry=${encodeURIComponent(data.name)}`)}
                      strokeWidth={2} stroke={p.CARD_BG}
                    >
                      {byIndustry.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={p.CHART_COLORS[i % p.CHART_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center" style={{ maxWidth: "80px" }}>
                    {activeIndustryIdx !== undefined && (byIndustry ?? [])[activeIndustryIdx] ? (
                      <>
                        <p style={{ fontSize: "1.5rem", fontWeight: 700, color: p.TEXT_PRIMARY, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                          {(byIndustry ?? [])[activeIndustryIdx].count}
                        </p>
                        <p style={{ fontSize: "10px", color: p.TEXT_SECONDARY, marginTop: "4px", lineHeight: 1.3, wordBreak: "break-word" }}>
                          {(byIndustry ?? [])[activeIndustryIdx].name}
                        </p>
                      </>
                    ) : (
                      <>
                        <p style={{ fontSize: "1.75rem", fontWeight: 700, color: p.TEXT_PRIMARY, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{industryTotal}</p>
                        <p style={{ fontSize: "11px", color: p.TEXT_SECONDARY, marginTop: "4px" }}>total</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                {byIndustry.slice(0, 8).map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.CHART_COLORS[i % p.CHART_COLORS.length] }} />
                    <span className="text-[11px] truncate" style={{ color: p.TEXT_SECONDARY }}>{d.name}</span>
                    <span className="text-[11px] font-semibold tabular-nums ml-auto shrink-0" style={{ color: p.TEXT_PRIMARY }}>{d.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </NeuCard>
      </div>

      {/* By Status + By Location */}
      <div className="grid gap-5 md:grid-cols-2">
        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Radio className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.TEXT_SECONDARY }} />
            Leads by Status
          </p>
          {!bySource ? <Skeleton className="h-[180px] w-full" /> : bySource.length === 0 ? (
            <p className="text-center text-sm py-8" style={{ color: p.TEXT_SECONDARY }}>No status data yet.</p>
          ) : (
            <div className="space-y-3">
              {bySource.slice(0, 8).map((src, i) => {
                const max = bySource[0]?.count ?? 1;
                const pct = Math.round((src.count / max) * 100);
                return (
                  <div key={src.name} className="space-y-1.5 cursor-pointer rounded-[12px] px-2 py-1.5 -mx-2 transition-all duration-150 hover:opacity-80"
                    onClick={() => navigate(buildLeadsUrl({ stageId: String((src as any).stageId) }))}>
                    <div className="flex justify-between text-xs">
                      <span className="font-medium capitalize" style={{ color: p.TEXT_PRIMARY }}>{src.name}</span>
                      <span className="tabular-nums" style={{ color: p.TEXT_SECONDARY }}>{src.count}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: p.TRACK_BG }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: p.CHART_COLORS[i % p.CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </NeuCard>

        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <MapPin className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.TEXT_SECONDARY }} />
            Leads by Location
          </p>
          {!byLocation ? <Skeleton className="h-[180px] w-full" /> : byLocation.length === 0 ? (
            <p className="text-center text-sm py-6" style={{ color: p.TEXT_SECONDARY }}>No location data yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {byLocation.slice(0, 12).map((loc, i) => (
                <div key={loc.name}
                  className="flex flex-col items-center rounded-[14px] px-3 py-2.5 cursor-pointer transition-all duration-150 hover:opacity-80"
                  style={{ background: p.ACCENT_BG }}
                  onClick={() => navigate(buildLeadsUrl({ location: loc.name }))}>
                  <span className="text-lg font-bold tabular-nums" style={{ color: p.CHART_COLORS[i % p.CHART_COLORS.length] }}>{loc.count}</span>
                  <span className="text-[11px] text-center truncate w-full mt-0.5" style={{ color: p.TEXT_SECONDARY }}>{loc.name}</span>
                </div>
              ))}
            </div>
          )}
        </NeuCard>
      </div>

      {/* ── Section label: Deal Revenue ──────────────────────────────────── */}
      <div className="flex items-center gap-2.5 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: p.TEXT_SECONDARY }}>Deal Revenue</span>
        <div className="flex-1 border-b" style={{ borderColor: `${p.GRID_COLOR}80` }} />
      </div>

      {/* Deals by Stage + Revenue Over Time */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-7">
        <NeuCard className="col-span-3">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Layers className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.TEXT_SECONDARY }} />
            Deals by Stage
          </p>
          {loadingDealsByStage ? <Skeleton className="h-[180px] w-full" /> : !dealsByStage || dealsByStage.length === 0 ? (
            <p className="text-center text-sm py-8" style={{ color: p.TEXT_SECONDARY }}>No deals yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dealsByStage} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barCategoryGap="40%">
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="stageName" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <RechartsTooltip content={<PremiumTooltip />} cursor={{ fill: p.ACCENT_BG }} />
                <Bar dataKey="count" name="Deals" shape={(props: any) => <GradientBar {...props} />}
                  cursor="pointer"
                  onClick={(data: any) => navigate(`/deals?stage=${data.isWon ? "won" : data.isLost ? "lost" : "active"}`)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </NeuCard>

        <NeuCard className="col-span-4">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <TrendingUp className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.TEXT_SECONDARY }} />
            Revenue Over Time
          </p>
          {loadingRevenue ? <Skeleton className="h-[180px] w-full" /> : !revenueOverTime || revenueOverTime.length === 0 ? (
            <p className="text-center text-sm py-8" style={{ color: p.TEXT_SECONDARY }}>No revenue entries yet. Add entries on individual deal pages.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={revenueOverTime} margin={{ top: 6, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="revOverTimeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={p.CHART_COLORS[0]} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={p.CHART_COLORS[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={AXIS_TICK} tickLine={false} axisLine={false} width={52}
                  tickFormatter={v => `₹${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <RechartsTooltip
                  formatter={(val: number, name: string) => [formatCurrency(val), name === "cumulative" ? "Cumulative" : "Monthly"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Area type="monotone" dataKey="cumulative" name="cumulative"
                  stroke={p.CHART_COLORS[0]} strokeWidth={2}
                  fill="url(#revOverTimeGrad)" dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: p.CHART_COLORS[0] }} />
                <Area type="monotone" dataKey="total" name="total"
                  stroke={p.CHART_COLORS[2]} strokeWidth={1.5} strokeDasharray="4 3"
                  fill="none" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </NeuCard>
      </div>

      {/* Leaderboard + Follow-ups */}
      <div className="grid gap-5 md:grid-cols-2">
        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Trophy className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />
            Team Leaderboard
          </p>
          {loadingLeaderboard ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}</div>
          ) : !leaderboard || leaderboard.length === 0 ? (
            <p className="text-center text-sm py-6" style={{ color: p.TEXT_SECONDARY }}>No team data yet.</p>
          ) : (
            <LeaderboardList items={leaderboard} onRepClick={userId => navigate(buildLeadsUrl({ ownerId: String(userId), status: "won" }))} />
          )}
        </NeuCard>

        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Calendar className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />
            Follow-ups Due
          </p>
          {loadingFollowups ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}</div>
          ) : followupsDue ? (
            <>
              <FollowUpUrgencyRow
                overdue={followupsDue.overdue} dueToday={followupsDue.dueToday} dueThisWeek={followupsDue.dueThisWeek}
                onOverdueClick={() => navigate(buildLeadsUrl({ followupDue: "overdue" }))}
                onTodayClick={() => navigate(buildLeadsUrl({ followupDue: "today" }))}
                onWeekClick={() => navigate(buildLeadsUrl({ followupDue: "week" }))}
              />
              {followupsDue.items.length === 0 ? (
                <p className="text-center text-sm py-4" style={{ color: p.TEXT_SECONDARY }}>No follow-ups due. Great job!</p>
              ) : (
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {followupsDue.items.slice(0, 10).map(f => (
                    <div key={f.id}
                      className="flex items-center gap-2 rounded-[12px] px-2.5 py-2 cursor-pointer transition-all duration-150 hover:opacity-80"
                      style={{ background: p.ACCENT_BG }}
                      onClick={() => navigate(`/leads/${f.leadId}`)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: p.TEXT_PRIMARY }}>{f.leadCompanyName}</p>
                        {f.notes && <p className="text-xs truncate" style={{ color: p.TEXT_SECONDARY }}>{f.notes}</p>}
                      </div>
                      <span className="text-xs shrink-0 font-medium"
                        style={{ color: new Date(f.scheduledAt) < new Date() ? p.NEGATIVE : p.TEXT_SECONDARY }}>
                        {format(parseISO(f.scheduledAt), "MMM d")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </NeuCard>
      </div>

      {/* Recent Activity */}
      <NeuCard>
        <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>Recent Activity</p>
        {loadingActivities ? (
          <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <ActivityFeed items={activities ?? []} onLeadClick={leadId => navigate(`/leads/${leadId}`)} />
        )}
      </NeuCard>
    </div>
  );
}
