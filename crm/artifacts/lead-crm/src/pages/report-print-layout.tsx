import React from "react";
import { createPortal } from "react-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
  ResponsiveContainer, Tooltip,
} from "recharts";

// ─── Fixed professional palette for print (no CSS variables) ──────────────────
const COLORS = [
  "#0B5FB0", "#10B981", "#F59E0B", "#6366F1",
  "#EC4899", "#14B8A6", "#F97316", "#8B5CF6",
  "#06B6D4", "#84CC16", "#EF4444", "#64748B",
];
const BRAND        = "#0B5FB0";
const BRAND_DARK   = "#093E78";
const WON_COLOR    = "#10B981";
const LOST_COLOR   = "#EF4444";
const NEUTRAL      = "#6B7280";
const BORDER       = "#E5E7EB";
const BG_SUBTLE    = "#F9FAFB";

// ─── Types matching the API responses ─────────────────────────────────────────
interface MonthlyRow  { month: string; year: number; created: number; won: number; lost: number }
interface NameCount   { name: string; count: number }
interface FunnelRow   { stage: string; count: number; percentage: number }
interface PerfRow     { userId: number; userName?: string | null; userAvatar?: string | null; totalLeads: number; activeLeads: number; wonLeads: number; lostLeads: number; conversionRate: number }

interface Props {
  monthly?:     MonthlyRow[];
  status?:      NameCount[];
  industry?:    NameCount[];
  location?:    NameCount[];
  funnel?:      FunnelRow[];
  performance?: PerfRow[];
}

// ─── Small layout helpers ──────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 10,
      paddingBottom: 6, borderBottom: `2px solid ${BRAND}`, textTransform: "uppercase" as const,
      letterSpacing: "0.04em" }}>
      {children}
    </div>
  );
}

function PageContinuedHeader({ title, dateStr }: { title: string; dateStr: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      marginBottom: 20, paddingBottom: 10, borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 4, height: 18, background: BRAND, borderRadius: 2 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: BRAND_DARK }}>{title}</span>
      </div>
      <span style={{ fontSize: 10, color: NEUTRAL }}>Rapport CRM · {dateStr}</span>
    </div>
  );
}

// ─── Main Print Layout ─────────────────────────────────────────────────────────
function ReportPrintContent({ monthly, status, industry, location, funnel, performance }: Props) {
  const now    = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  // KPI aggregates
  const totalCreated  = monthly?.reduce((s, r) => s + (r.created || 0), 0) ?? 0;
  const totalWon      = monthly?.reduce((s, r) => s + (r.won  || 0), 0) ?? 0;
  const totalLost     = monthly?.reduce((s, r) => s + (r.lost || 0), 0) ?? 0;
  const activeLeads   = performance?.reduce((s, u) => s + (u.activeLeads || 0), 0) ?? 0;
  const convDenom     = totalWon + totalLost;
  const convRate      = convDenom > 0 ? ((totalWon / convDenom) * 100).toFixed(1) + "%" : "—";
  const teamCount     = performance?.length ?? 0;

  const kpis = [
    { label: "Leads Created",   value: totalCreated, accent: BRAND      },
    { label: "Won Leads",       value: totalWon,     accent: WON_COLOR  },
    { label: "Lost Leads",      value: totalLost,    accent: LOST_COLOR },
    { label: "Active Leads",    value: activeLeads,  accent: "#F59E0B"  },
    { label: "Win Rate",        value: convRate,     accent: WON_COLOR  },
    { label: "Team Members",    value: teamCount,    accent: "#6366F1"  },
  ];

  const tooltipStyle = { borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 11, background: "white" };

  return (
    <div id="crm-report-print"
      style={{ fontFamily: "system-ui, 'Helvetica Neue', Arial, sans-serif",
               background: "white", color: "#111827", width: "794px" }}>

      {/* ═══════════════ PAGE 1: Header + KPIs + Lead Growth ═══════════════ */}
      <div style={{ pageBreakAfter: "always" as const }}>

        {/* Report Header */}
        <div style={{ background: BRAND_DARK, color: "white", padding: "22px 32px", marginBottom: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Rapport logo mark */}
                <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
                  <rect x="2" y="2" width="60" height="60" rx="16" fill="#4F46E5" />
                  <circle cx="24" cy="30" r="9" fill="#ffffff" fillOpacity={0.95} />
                  <circle cx="40" cy="30" r="9" fill="#ffffff" fillOpacity={0.55} />
                  <path d="M19 46c2.5-4 7-6.5 13-6.5S42.5 42 45 46" stroke="#ffffff" strokeWidth={3.2} strokeLinecap="round" fill="none" />
                </svg>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>Rapport</div>
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>CRM Performance Report</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>Generated: {dateStr} at {timeStr}</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>Reporting Period: Last 12 Months</div>
            </div>
          </div>
        </div>

        {/* Yellow accent bar */}
        <div style={{ height: 4, background: "#FFE07A" }} />

        {/* Executive KPI Summary */}
        <div style={{ padding: "20px 32px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: NEUTRAL, textTransform: "uppercase" as const,
            letterSpacing: "0.08em", marginBottom: 12 }}>Executive Summary — Last 12 Months</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
            {kpis.map((k, i) => (
              <div key={i} style={{ background: BG_SUBTLE, border: `1px solid ${BORDER}`,
                borderTop: `3px solid ${k.accent}`, borderRadius: 8, padding: "12px 10px" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: k.accent, lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: 10, color: NEUTRAL, marginTop: 5, fontWeight: 500, lineHeight: 1.3 }}>{k.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Lead Growth Line Chart */}
        <div style={{ padding: "0 32px 24px" }}>
          <SectionTitle>Lead Growth (Last 12 Months)</SectionTitle>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthly || []} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BORDER} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: NEUTRAL }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: NEUTRAL }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Line type="monotone" dataKey="created" name="Created" stroke={BRAND}      strokeWidth={2.5} dot={{ r: 3, fill: BRAND }}      activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="won"     name="Won"     stroke={WON_COLOR}  strokeWidth={2.5} dot={{ r: 3, fill: WON_COLOR }}  activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="lost"    name="Lost"    stroke={LOST_COLOR} strokeWidth={2.5} dot={{ r: 3, fill: LOST_COLOR }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly data table below chart */}
        {(monthly || []).length > 0 && (
          <div style={{ padding: "0 32px 28px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: BG_SUBTLE }}>
                  {["Month", "Year", "Created", "Won", "Lost"].map(h => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: h === "Month" || h === "Year" ? "left" : "right",
                      color: NEUTRAL, fontWeight: 600, borderBottom: `1px solid ${BORDER}`, fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(monthly || []).map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? "white" : BG_SUBTLE }}>
                    <td style={{ padding: "5px 10px", color: "#374151" }}>{r.month}</td>
                    <td style={{ padding: "5px 10px", color: "#374151" }}>{r.year}</td>
                    <td style={{ padding: "5px 10px", textAlign: "right", color: BRAND, fontWeight: 600 }}>{r.created}</td>
                    <td style={{ padding: "5px 10px", textAlign: "right", color: WON_COLOR, fontWeight: 600 }}>{r.won}</td>
                    <td style={{ padding: "5px 10px", textAlign: "right", color: LOST_COLOR }}>{r.lost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════ PAGE 2: Industry + Location + Status ═══════════════ */}
      <div style={{ pageBreakAfter: (status && status.length > 0) ? "always" as const : "avoid" as const }}>
        <div style={{ padding: "28px 32px 0" }}>
          <PageContinuedHeader title="Industry & Location Analytics" dateStr={dateStr} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
            {/* Leads by Industry */}
            <div>
              <SectionTitle>Leads by Industry</SectionTitle>
              {(industry || []).length === 0 ? (
                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center",
                  color: NEUTRAL, fontSize: 12, background: BG_SUBTLE, borderRadius: 8 }}>No industry data</div>
              ) : (
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={industry || []} cx="50%" cy="42%" innerRadius={55} outerRadius={90}
                        paddingAngle={2} dataKey="count" nameKey="name">
                        {(industry || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Leads by Location */}
            <div>
              <SectionTitle>Leads by Location</SectionTitle>
              {(location || []).length === 0 ? (
                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center",
                  color: NEUTRAL, fontSize: 12, background: BG_SUBTLE, borderRadius: 8 }}>No location data</div>
              ) : (
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={(location || []).slice(0, 10)} layout="vertical"
                      margin={{ top: 5, right: 16, left: 55, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={BORDER} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: NEUTRAL }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: NEUTRAL }}
                        tickLine={false} axisLine={false} width={50} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" name="Leads" radius={[0, 4, 4, 0]}>
                        {(location || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Lead Status Distribution (bonus section) */}
          {status && status.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <SectionTitle>Lead Status Distribution</SectionTitle>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={status} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BORDER} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: NEUTRAL }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: NEUTRAL }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]}>
                      {status.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════ PAGE 3: Pipeline Funnel + Team Performance ═══════════════ */}
      <div>
        <div style={{ padding: "28px 32px 0" }}>
          <PageContinuedHeader title="Pipeline & Team Performance" dateStr={dateStr} />

          {/* Conversion Funnel */}
          <div style={{ marginBottom: 28 }}>
            <SectionTitle>Conversion Funnel by Stage</SectionTitle>
            {(funnel || []).length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: NEUTRAL, fontSize: 12,
                background: BG_SUBTLE, borderRadius: 8 }}>No pipeline data available.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(funnel || []).map((stage, i) => (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: "#374151", fontWeight: 600 }}>{stage.stage}</span>
                      <span style={{ color: NEUTRAL }}>{stage.count} leads · {stage.percentage}%</span>
                    </div>
                    <div style={{ height: 22, background: "#F3F4F6", borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(stage.percentage, 1)}%`,
                        background: COLORS[i % COLORS.length], borderRadius: 5,
                        display: "flex", alignItems: "center", paddingLeft: 8 }}>
                        {stage.percentage >= 8 && (
                          <span style={{ fontSize: 9, color: "white", fontWeight: 700 }}>{stage.percentage}%</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Team Performance Table */}
          <div style={{ marginBottom: 28 }}>
            <SectionTitle>Team Performance</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: BRAND_DARK }}>
                  {[
                    { label: "Team Member", right: false },
                    { label: "Total Leads", right: true },
                    { label: "Active", right: true },
                    { label: "Won", right: true, color: WON_COLOR },
                    { label: "Lost", right: true, color: LOST_COLOR },
                    { label: "Win Rate", right: true },
                  ].map((h, i) => (
                    <th key={i} style={{ padding: "10px 12px", textAlign: h.right ? "right" : "left",
                      color: h.color ?? "white", fontWeight: 600, fontSize: 10,
                      letterSpacing: "0.04em" }}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(performance || []).map((u, i) => (
                  <tr key={u.userId} style={{ borderBottom: `1px solid ${BORDER}`,
                    background: i % 2 === 0 ? "white" : BG_SUBTLE }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 26, height: 26, borderRadius: "50%",
                          background: COLORS[i % COLORS.length], display: "flex",
                          alignItems: "center", justifyContent: "center",
                          color: "white", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                          {(u.userName ?? "U").charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, color: "#111827" }}>{u.userName ?? "Unknown"}</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#374151" }}>{u.totalLeads}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#374151" }}>{u.activeLeads}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: WON_COLOR, fontWeight: 700 }}>{u.wonLeads}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: LOST_COLOR }}>{u.lostLeads}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700,
                      color: u.conversionRate >= 50 ? WON_COLOR : "#374151" }}>
                      {u.conversionRate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                {(performance || []).length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: NEUTRAL }}>
                      No performance data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Report Footer */}
          <div style={{ marginTop: 24, paddingTop: 14, borderTop: `2px solid ${BRAND}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: 9, color: NEUTRAL }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 3, height: 12, background: BRAND, borderRadius: 2 }} />
              <span style={{ fontWeight: 700, color: BRAND }}>Rapport CRM</span>
              <span>— Analytics</span>
            </div>
            <span style={{ fontStyle: "italic" }}>Confidential — Internal Use Only</span>
            <span>Generated {dateStr} at {timeStr}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Portal wrapper — renders off-screen so charts are always sized correctly ──
export function ReportPrintLayout(props: Props) {
  if (typeof document === "undefined") return null;
  return createPortal(<ReportPrintContent {...props} />, document.body);
}
