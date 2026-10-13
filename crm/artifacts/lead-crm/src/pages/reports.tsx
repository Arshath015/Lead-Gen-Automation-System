import { useLocation } from "wouter";
import { 
  useGetMonthlyGrowth, 
  useGetLeadsByStatus, 
  useGetLeadsByIndustry, 
  useGetLeadsByLocation,
  useGetConversionFunnel,
  useGetUserPerformance 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Cell,
  LineChart, Line, PieChart, Pie, Legend
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Download, Printer } from "lucide-react";
import { usePalette } from "./dashboard/dashboard-ui";
import { ReportPrintLayout } from "./report-print-layout";

function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetch the full ungrouped/uncapped data from a reports endpoint for CSV export. */
async function fetchRaw(path: string): Promise<{ name: string; count: number }[]> {
  const sep = path.includes("?") ? "&" : "?";
  const resp = await fetch(`/api${path}${sep}raw=true`, {
    credentials: "include",
    headers: { "x-csrf-token": "x" },
  });
  if (!resp.ok) return [];
  return resp.json();
}

export default function Reports() {
  const [, navigate] = useLocation();
  const p = usePalette();
  const COLORS = p.CHART_COLORS;
  const { data: monthly, isLoading: loadingMonthly } = useGetMonthlyGrowth({ months: 12 });
  const { data: status, isLoading: loadingStatus } = useGetLeadsByStatus({});
  const { data: industry, isLoading: loadingIndustry } = useGetLeadsByIndustry({});
  const { data: location, isLoading: loadingLocation } = useGetLeadsByLocation({});
  const { data: funnel, isLoading: loadingFunnel } = useGetConversionFunnel();
  const { data: performance, isLoading: loadingPerformance } = useGetUserPerformance({});

  // Give charts a moment to finish rendering before triggering print
  const handlePrint = () => {
    setTimeout(() => window.print(), 150);
  };

  const handleExportMonthly = () => {
    if (!monthly) return;
    exportCsv("monthly-growth.csv", ["Month", "Year", "Created", "Won", "Lost"],
      monthly.map(r => [r.month, r.year, r.created, r.won, r.lost]));
  };

  const handleExportIndustry = async () => {
    // Raw export: all unique values, no length filter, no top-N cap
    const raw = await fetchRaw("/reports/leads-by-industry");
    exportCsv("leads-by-industry.csv", ["Industry", "Count"], raw.map(r => [r.name, r.count]));
  };

  const handleExportLocation = async () => {
    // Raw export: all unique raw address strings, no normalisation, no top-N cap
    const raw = await fetchRaw("/reports/leads-by-location");
    exportCsv("leads-by-location.csv", ["Location", "Count"], raw.map(r => [r.name, r.count]));
  };

  const handleExportPerformance = () => {
    if (!performance) return;
    exportCsv("team-performance.csv", ["Name", "Total", "Active", "Won", "Lost", "Win Rate %"],
      performance.map(r => [r.userName ?? "", r.totalLeads, r.activeLeads, r.wonLeads, r.lostLeads, r.conversionRate.toFixed(1)]));
  };

  return (
    <div className="space-y-6">
      {/* Dedicated print layout — renders off-screen via Portal; visible only during window.print() */}
      <ReportPrintLayout
        monthly={monthly}
        status={status}
        industry={industry}
        location={location}
        funnel={funnel}
        performance={performance}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Detailed metrics and performance analytics.</p>
        </div>
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print / Export PDF
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lead Growth (Last 12 Months)</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleExportMonthly} disabled={!monthly}>
              <Download className="h-4 w-4 mr-1.5" />CSV
            </Button>
          </CardHeader>
          <CardContent>
            {loadingMonthly ? (
              <div className="h-[300px] flex items-center justify-center"><Skeleton className="h-full w-full" /></div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthly || []} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }} />
                  <Legend />
                  <Line type="monotone" dataKey="created" name="Created" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="won" name="Won" stroke={COLORS[2]} strokeWidth={2} />
                  <Line type="monotone" dataKey="lost" name="Lost" stroke={p.NEGATIVE} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Leads by Industry</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleExportIndustry}>
              <Download className="h-4 w-4 mr-1.5" />CSV
            </Button>
          </CardHeader>
          <CardContent>
            {loadingIndustry ? (
              <div className="h-[380px] flex items-center justify-center"><Skeleton className="h-full w-full" /></div>
            ) : (industry || []).length === 0 ? (
              <div className="h-[380px] flex items-center justify-center text-muted-foreground text-sm">No industry data yet.</div>
            ) : (() => {
              const data = industry || [];
              const total = data.reduce((s, r) => s + r.count, 0);
              return (
                <div>
                  {/* Pie — no inline Legend to avoid label crowding */}
                  <ResponsiveContainer width="100%" height={210}>
                    <PieChart>
                      <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={88}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="name"
                        cursor="pointer"
                        onClick={(d: any) => {
                          if (d.name === "Other") return; // no drill-through for the catch-all bucket
                          navigate(`/leads?industry=${encodeURIComponent(d.name)}`);
                        }}
                      >
                        {data.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.name === "Other" ? "hsl(var(--muted-foreground))" : COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))" }}
                        formatter={(value: number, name: string) => {
                          const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
                          const label = name === "Other"
                            ? "Other categories — use CSV export for full breakdown"
                            : name;
                          return [`${value} leads (${pct}%)`, label];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Custom legend — 2-column grid, truncated names, click to drill down */}
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 px-1">
                    {data.map((entry, index) => {
                      const color = entry.name === "Other" ? "hsl(var(--muted-foreground))" : COLORS[index % COLORS.length];
                      const pct   = total > 0 ? Math.round((entry.count / total) * 100) : 0;
                      const label = entry.name.length > 20 ? entry.name.substring(0, 20) + "…" : entry.name;
                      const isOther = entry.name === "Other";
                      return (
                        <button
                          key={index}
                          className={`flex items-center gap-1.5 text-left min-w-0 rounded px-0.5 py-0.5 transition-colors ${isOther ? "cursor-default opacity-60" : "hover:bg-muted/60 cursor-pointer"}`}
                          title={isOther ? `${entry.count} leads across categories not in top 10 — use CSV export for full breakdown` : entry.name}
                          onClick={() => { if (!isOther) navigate(`/leads?industry=${encodeURIComponent(entry.name)}`); }}
                        >
                          <span className="flex-shrink-0 w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                          <span className="text-[11px] text-muted-foreground truncate flex-1">{label}</span>
                          <span className="flex-shrink-0 text-[11px] font-medium tabular-nums">{pct}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Leads by Location</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleExportLocation}>
              <Download className="h-4 w-4 mr-1.5" />CSV
            </Button>
          </CardHeader>
          <CardContent>
            {loadingLocation ? (
              <div className="h-[300px] flex items-center justify-center"><Skeleton className="h-full w-full" /></div>
            ) : (location || []).length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No location data yet. Add locations to your leads.</div>
            ) : (() => {
              const data = location || [];
              // Dynamic height: 32px per bar, min 240px, max 420px
              const chartH = Math.min(420, Math.max(240, data.length * 36));
              return (
                <ResponsiveContainer width="100%" height={chartH}>
                  <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      width={90}
                      tickFormatter={(v: string) => v.length > 12 ? v.substring(0, 11) + "…" : v}
                    />
                    <RechartsTooltip
                      contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: number, _: string, props: any) => {
                        const name: string = props?.payload?.name ?? "";
                        const label = name === "Other"
                          ? "Other cities — use CSV export for full breakdown"
                          : name;
                        return [`${value} leads`, label];
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="Leads"
                      radius={[0, 4, 4, 0]}
                    >
                      {data.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.name === "Other" ? "hsl(var(--muted-foreground))" : COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingFunnel ? (
              <div className="h-[300px] flex items-center justify-center"><Skeleton className="h-full w-full" /></div>
            ) : (
              <div className="space-y-2 pt-2">
                {(funnel || []).map((stage, index) => (
                  <div key={index} className="space-y-1 cursor-pointer rounded-md p-1 -mx-1 hover:bg-muted/60 transition-colors" onClick={() => navigate(`/leads?stageId=${(stage as any).stageId}`)} title={`View leads in ${stage.stage}`}>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{stage.stage}</span>
                      <span className="font-medium">{stage.count} ({stage.percentage}%)</span>
                    </div>
                    <div className="h-6 rounded-sm bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-sm transition-all"
                        style={{ width: `${stage.percentage}%`, backgroundColor: COLORS[index % COLORS.length] }}
                      />
                    </div>
                  </div>
                ))}
                {(funnel || []).length === 0 && (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No pipeline data yet.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Team Performance</CardTitle>
          <Button variant="ghost" size="sm" onClick={handleExportPerformance} disabled={!performance}>
            <Download className="h-4 w-4 mr-1.5" />CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-6">Team Member</TableHead>
                <TableHead className="text-right">Total Leads</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Won</TableHead>
                <TableHead className="text-right">Lost</TableHead>
                <TableHead className="text-right px-6">Win Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingPerformance ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Skeleton className="h-4 w-32 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : performance?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No performance data found.
                  </TableCell>
                </TableRow>
              ) : (
                performance?.map((user) => (
                  <TableRow key={user.userId} className="hover:bg-muted/50">
                    <TableCell className="px-6 py-4 cursor-pointer" onClick={() => navigate(`/leads?ownerId=${user.userId}`)} title={`View all leads for ${user.userName}`}>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.userAvatar || ""} />
                          <AvatarFallback>{user.userName?.charAt(0) || "U"}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{user.userName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <button className="tabular-nums hover:text-primary hover:underline transition-colors cursor-pointer" onClick={() => navigate(`/leads?ownerId=${user.userId}`)} title={`All ${user.totalLeads} leads`}>{user.totalLeads}</button>
                    </TableCell>
                    <TableCell className="text-right">
                      <button className="tabular-nums hover:text-primary hover:underline transition-colors cursor-pointer" onClick={() => navigate(`/leads?ownerId=${user.userId}&status=active`)} title={`${user.activeLeads} active leads`}>{user.activeLeads}</button>
                    </TableCell>
                    <TableCell className="text-right font-medium text-primary">
                      <button className="tabular-nums hover:underline transition-colors cursor-pointer" onClick={() => navigate(`/leads?ownerId=${user.userId}&status=won`)} title={`${user.wonLeads} won leads`}>{user.wonLeads}</button>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <button className="tabular-nums hover:text-foreground hover:underline transition-colors cursor-pointer" onClick={() => navigate(`/leads?ownerId=${user.userId}&status=lost`)} title={`${user.lostLeads} lost leads`}>{user.lostLeads}</button>
                    </TableCell>
                    <TableCell className="text-right px-6 font-medium">
                      {user.conversionRate.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
