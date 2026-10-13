import { useState } from "react";
import {
  useGetDashboardStats, getGetDashboardStatsQueryKey, useGetPipelineData, useGetConversionFunnel,
  useGetRecentActivities, useGetDashboardLeaderboard, useGetDashboardFollowupsDue,
  useListUsers, useAssignLead, useListLeads,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Users, Target, CheckCircle2, XCircle, TrendingUp, Calendar, Trophy, UserPlus, Percent } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import DateRangeFilter, { useDefaultDateRange, type DateRangeValue } from "@/components/date-range-filter";
import { PipelineStageLinks, stageIdFromBarEvent } from "./pipeline-stage-links";
import {
  StatCard, PremiumTooltip, GradientBar, LeaderboardList,
  ActivityFeed, FollowUpUrgencyRow, usePalette,
} from "./dashboard-ui";

const WIN_RATE_TARGET = 25;

function NeuCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const p = usePalette();
  return (
    <div className={`rounded-[20px] p-5 ${className}`} style={{ boxShadow: "var(--neuo-shadow)", backgroundColor: p.CARD_BG }}>
      {children}
    </div>
  );
}

export default function ManagerDashboard() {
  const [, navigate] = useLocation();
  const { user: currentUser } = useAuth();
  const [dateRange, setDateRange] = useState<DateRangeValue>(useDefaultDateRange());
  const [selectedRepId, setSelectedRepId] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const p = usePalette();

  const AXIS_TICK = { fill: p.TEXT_SECONDARY, fontSize: 11 };
  const GRID_PROPS = { strokeDasharray: "3 3" as const, vertical: false as const, stroke: p.GRID_COLOR, strokeOpacity: 0.6 };

  const buildLeadsUrl = (extra: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    if (dateRange.from) qs.set("dateFrom", dateRange.from);
    if (dateRange.to) qs.set("dateTo", dateRange.to);
    if (selectedRepId !== "all") qs.set("ownerId", selectedRepId);
    for (const [k, v] of Object.entries(extra)) { if (v != null) qs.set(k, v); }
    const s = qs.toString();
    return s ? `/leads?${s}` : "/leads";
  };

  const params = { from: dateRange.from, to: dateRange.to };
  const repParams = selectedRepId !== "all" ? { ...params, ownerId: parseInt(selectedRepId) } : params;

  const { data: users } = useListUsers();
  const { data: stats, isLoading: loadingStats } = useGetDashboardStats(repParams, {
    query: { queryKey: getGetDashboardStatsQueryKey(repParams), refetchInterval: 60_000 },
  });
  const { data: pipeline, isLoading: loadingPipeline } = useGetPipelineData(repParams);
  const { data: funnel, isLoading: loadingFunnel } = useGetConversionFunnel(repParams);
  const { data: leaderboard, isLoading: loadingLeaderboard } = useGetDashboardLeaderboard(repParams);
  const { data: followupsDue, isLoading: loadingFollowups } = useGetDashboardFollowupsDue(repParams);
  const { data: recentActivity, isLoading: loadingActivity } = useGetRecentActivities({ limit: 6, from: dateRange.from, to: dateRange.to });
  const { data: activeLeadsData, isLoading: loadingUnassigned } = useListLeads({ limit: 100 });
  const assignLead = useAssignLead();

  const teamReps = users?.filter(u =>
    u.role === "bd" && (currentUser?.teamId ? u.teamId === currentUser.teamId : true)
  ) ?? [];
  const unassignedLeads = (activeLeadsData?.leads ?? []).filter(l => l.ownerId === null);
  const selectedRepName = selectedRepId !== "all"
    ? teamReps.find(r => String(r.id) === selectedRepId)?.username ?? ""
    : "";

  const handleAssign = (leadId: number, repId: number) => {
    assignLead.mutate({ id: leadId, data: { ownerId: repId } }, {
      onSuccess: () => {
        toast({ title: "Lead assigned successfully" });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: p.TEXT_PRIMARY }}>Manager Dashboard</h1>
          <p className="text-sm" style={{ color: p.TEXT_SECONDARY }}>Your team's pipeline performance</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedRepId} onValueChange={setSelectedRepId}>
            <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="All reps" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reps</SelectItem>
              {teamReps.map(rep => (
                <SelectItem key={rep.id} value={String(rep.id)}>
                  {rep.firstName && rep.lastName ? `${rep.firstName} ${rep.lastName}` : rep.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Total Leads" value={stats?.totalLeads ?? 0} icon={Users} description={selectedRepId !== "all" ? "Selected rep" : "Team total"} loading={loadingStats} onClick={() => navigate(buildLeadsUrl())} />
        <StatCard title="Active" value={stats?.activeLeads ?? 0} icon={TrendingUp} description="In pipeline" loading={loadingStats} onClick={() => navigate(buildLeadsUrl({ status: "active" }))} />
        <StatCard title="Won" value={stats?.wonLeads ?? 0} icon={CheckCircle2} description="Closed won" loading={loadingStats} highlight={p.ACCENT} onClick={() => navigate("/deals?stage=won")} />
        <StatCard title="Lost" value={stats?.lostLeads ?? 0} icon={XCircle} description="Closed lost" loading={loadingStats} highlight={p.NEGATIVE} onClick={() => navigate("/deals?stage=lost")} />
        <StatCard title="Win Rate" value={`${(stats?.conversionRate ?? 0).toFixed(1)}%`} icon={Target} description="Conversion" loading={loadingStats} />
        <StatCard title="Follow-ups Due" value={stats?.followupsDue ?? 0} icon={Calendar} description="Pending actions" loading={loadingStats} onClick={() => navigate(buildLeadsUrl())} />
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-7">
        <NeuCard className="col-span-3">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Trophy className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />Rep Leaderboard
          </p>
          {loadingLeaderboard ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}</div>
          ) : !leaderboard || leaderboard.length === 0 ? (
            <p className="text-center text-sm py-6" style={{ color: p.TEXT_SECONDARY }}>No team data yet.</p>
          ) : (
            <LeaderboardList items={leaderboard} onRepClick={userId => navigate(buildLeadsUrl({ ownerId: String(userId), status: "won" }))} />
          )}
        </NeuCard>

        <NeuCard className="col-span-4">
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            Pipeline by Stage
            {selectedRepId !== "all" && selectedRepName && (
              <span style={{ fontWeight: 400, color: p.TEXT_SECONDARY, fontSize: "12px", marginLeft: "8px" }}>— {selectedRepName}</span>
            )}
          </p>
          {loadingPipeline ? <Skeleton className="h-[220px] w-full" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipeline ?? []} margin={{ top: 6, right: 16, left: 0, bottom: 4 }} barCategoryGap="35%">
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="stageName" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <RechartsTooltip content={<PremiumTooltip />} cursor={{ fill: p.ACCENT_BG }} />
                <Bar dataKey="count" name="Leads" shape={(props: any) => <GradientBar {...props} />} cursor="pointer"
                  onClick={(data: any) => {
                    const stageId = stageIdFromBarEvent(data);
                    if (stageId) navigate(buildLeadsUrl({ stageId: String(stageId) }));
                  }} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <PipelineStageLinks stages={pipeline ?? []} onSelect={stageId => navigate(buildLeadsUrl({ stageId: String(stageId) }))} />
        </NeuCard>
      </div>

      <NeuCard>
        <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
          Conversion Funnel
          {selectedRepId !== "all" && selectedRepName && (
            <span style={{ fontWeight: 400, color: p.TEXT_SECONDARY, fontSize: "12px", marginLeft: "8px" }}>— {selectedRepName}</span>
          )}
        </p>
        {loadingFunnel ? <Skeleton className="h-[180px] w-full" /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              {(funnel ?? []).map((step, i) => (
                <div key={step.stage}
                  className="space-y-1.5 cursor-pointer rounded-[12px] px-2 py-1.5 -mx-2 transition-all duration-150 hover:opacity-80"
                  onClick={() => navigate(buildLeadsUrl({ stageId: String((step as any).stageId) }))}>
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
            <div className="grid grid-cols-2 gap-2 self-start">
              {(funnel ?? []).slice(0, 6).map((step, i) => (
                <div key={step.stage}
                  className="rounded-[14px] p-3 text-center cursor-pointer transition-all duration-150 hover:opacity-80"
                  style={{ background: p.ACCENT_BG }}
                  onClick={() => navigate(buildLeadsUrl({ stageId: String((step as any).stageId) }))}>
                  <p className="text-xl font-bold tabular-nums" style={{ color: p.CHART_COLORS[i % p.CHART_COLORS.length] }}>{step.count}</p>
                  <p className="text-[11px] truncate mt-0.5" style={{ color: p.TEXT_SECONDARY }}>{step.stage}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </NeuCard>

      <div className="grid gap-5 md:grid-cols-2">
        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <UserPlus className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />Unassigned Leads
            {!loadingUnassigned && (
              <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums" style={{ background: p.ACCENT_BG, color: p.ACCENT }}>
                {unassignedLeads.length}
              </span>
            )}
          </p>
          {loadingUnassigned ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
          ) : unassignedLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-8 w-8 mb-2" style={{ color: p.ACCENT }} />
              <p className="text-sm" style={{ color: p.TEXT_SECONDARY }}>All active leads are assigned!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {unassignedLeads.slice(0, 10).map(lead => (
                <div key={lead.id} className="flex items-center gap-2 rounded-[12px] px-3 py-2" style={{ background: p.ACCENT_BG }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: p.TEXT_PRIMARY }}>{lead.companyName}</p>
                    <p className="text-xs truncate" style={{ color: p.TEXT_SECONDARY }}>{lead.contactPerson || lead.industry || "—"}</p>
                  </div>
                  <Select onValueChange={val => handleAssign(lead.id, parseInt(val))} disabled={assignLead.isPending}>
                    <SelectTrigger className="w-36 h-7 text-xs"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                    <SelectContent>
                      {teamReps.map(rep => (
                        <SelectItem key={rep.id} value={String(rep.id)} className="text-xs">
                          {rep.firstName && rep.lastName ? `${rep.firstName} ${rep.lastName}` : rep.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {unassignedLeads.length > 10 && (
                <p className="text-center text-xs pt-1" style={{ color: p.TEXT_SECONDARY }}>+{unassignedLeads.length - 10} more unassigned</p>
              )}
            </div>
          )}
        </NeuCard>

        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Percent className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />Quota vs Attainment
            <span style={{ fontWeight: 400, color: p.TEXT_SECONDARY, fontSize: "12px", marginLeft: "8px" }}>Target: {WIN_RATE_TARGET}%</span>
          </p>
          {loadingLeaderboard ? (
            <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !leaderboard || leaderboard.length === 0 ? (
            <p className="text-center text-sm py-6" style={{ color: p.TEXT_SECONDARY }}>No team data yet.</p>
          ) : (
            <div className="space-y-4">
              {leaderboard.map(rep => {
                const rate = parseFloat(String(rep.conversionRate ?? 0));
                const pct = Math.min(100, Math.round((rate / WIN_RATE_TARGET) * 100));
                const atTarget = rate >= WIN_RATE_TARGET;
                const barColor = atTarget ? p.ACCENT : rate >= WIN_RATE_TARGET * 0.75 ? p.SECONDARY : p.NEGATIVE;
                return (
                  <div key={rep.userId}
                    className="space-y-1.5 cursor-pointer rounded-[12px] px-2 py-1.5 -mx-2 transition-all duration-150 hover:opacity-80"
                    onClick={() => navigate(buildLeadsUrl({ ownerId: String(rep.userId), status: "won" }))}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium truncate max-w-[140px]" style={{ color: p.TEXT_PRIMARY }}>{rep.userName}</span>
                      <span className="font-semibold tabular-nums" style={{ color: barColor }}>{rate.toFixed(1)}% / {WIN_RATE_TARGET}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: p.TRACK_BG }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
                    </div>
                    <div className="flex justify-between text-xs" style={{ color: p.TEXT_SECONDARY }}>
                      <span>{rep.wonLeads} won of {rep.totalLeads} leads</span>
                      <span>{atTarget ? "✓ On target" : `${(WIN_RATE_TARGET - rate).toFixed(1)}% gap`}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </NeuCard>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>
            <Calendar className="h-3.5 w-3.5 inline mr-1.5" style={{ color: p.ACCENT }} />Team Follow-ups Due
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
                <p className="text-center text-sm py-4" style={{ color: p.TEXT_SECONDARY }}>No follow-ups due. All good!</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {followupsDue.items.slice(0, 8).map(f => (
                    <div key={f.id}
                      className="flex items-center gap-2 rounded-[12px] px-2.5 py-2 cursor-pointer transition-all duration-150 hover:opacity-80"
                      style={{ background: p.ACCENT_BG }}
                      onClick={() => navigate(`/leads/${f.leadId}`)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: p.TEXT_PRIMARY }}>{f.leadCompanyName}</p>
                        {f.contactPerson && <p className="text-xs" style={{ color: p.TEXT_SECONDARY }}>{f.contactPerson}</p>}
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

        <NeuCard>
          <p style={{ fontSize: "13px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "16px" }}>Recent Activity</p>
          {loadingActivity ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <ActivityFeed items={recentActivity ?? []} onLeadClick={leadId => navigate(`/leads/${leadId}`)} />
          )}
        </NeuCard>
      </div>
    </div>
  );
}
