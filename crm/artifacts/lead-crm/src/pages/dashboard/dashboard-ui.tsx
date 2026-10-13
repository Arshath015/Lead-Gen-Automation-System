import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { useThemeContext } from "@/context/theme-context";

// ── Palettes ────────────────────────────────────────────────────────────────
// Ink wash (cards/containers) + Burnt sienna (charts/graphs).

const LIGHT_PAL = {
  ACCENT:        "#6D8196",   // ink wash steel blue-gray
  SECONDARY:     "#F4A460",   // burnt sienna sandy brown (gradient stop)
  TEXT_PRIMARY:  "#4A4A4A",   // ink wash charcoal
  TEXT_SECONDARY:"#7A7A7A",   // mid-gray
  NEGATIVE:      "#C05040",   // sienna-red (lost/overdue)
  CHART_COLORS: [
    "#E35336",               // burnt sienna
    "#3B82F6",               // vivid blue
    "#10B981",               // emerald green
    "#8B5CF6",               // violet
    "#F59E0B",               // amber/gold
    "#EC4899",               // pink
    "#06B6D4",               // cyan
  ] as string[],
  ACCENT_BG:     "rgba(109,129,150,0.10)",
  TRACK_BG:      "rgba(109,129,150,0.08)",
  POS_PILL_BG:   "rgba(109,129,150,0.12)",
  NEG_PILL_BG:   "rgba(227,83,54,0.10)",
  OVERDUE_BG:    "rgba(227,83,54,0.08)",
  TODAY_BG:      "rgba(109,129,150,0.08)",
  WEEK_BG:       "rgba(109,129,150,0.05)",
  ROW_BG:        ["rgba(227,83,54,0.06)", "rgba(244,164,96,0.06)", "rgba(109,129,150,0.04)"] as string[],
  GRID_COLOR:    "#CBCBCB",
  CARD_BG:       "#FFFFFF",
};

const DARK_PAL = {
  ACCENT:        "#8AA5B8",   // lighter ink wash blue-gray (legible on dark)
  SECONDARY:     "#F5B570",   // brighter amber for dark bg
  TEXT_PRIMARY:  "#FFFFE3",   // ink wash cream (reversed)
  TEXT_SECONDARY:"#CBCBCB",   // ink wash light gray
  NEGATIVE:      "#E07060",   // lighter sienna-red for dark bg
  CHART_COLORS: [
    "#F06548",               // vivid sienna
    "#60A5FA",               // light blue
    "#34D399",               // light emerald
    "#A78BFA",               // light violet
    "#FCD34D",               // golden yellow
    "#F472B6",               // light pink
    "#22D3EE",               // bright cyan
  ] as string[],
  ACCENT_BG:     "rgba(138,165,184,0.15)",
  TRACK_BG:      "rgba(138,165,184,0.12)",
  POS_PILL_BG:   "rgba(138,165,184,0.18)",
  NEG_PILL_BG:   "rgba(240,101,72,0.18)",
  OVERDUE_BG:    "rgba(240,101,72,0.12)",
  TODAY_BG:      "rgba(138,165,184,0.15)",
  WEEK_BG:       "rgba(138,165,184,0.10)",
  ROW_BG:        ["rgba(240,101,72,0.14)", "rgba(245,181,112,0.10)", "rgba(138,165,184,0.06)"] as string[],
  GRID_COLOR:    "rgba(203,203,203,0.15)",
  CARD_BG:       "#1C1F26",
};

type Palette = typeof LIGHT_PAL;

export function usePalette(): Palette {
  const { theme } = useThemeContext();
  return theme === "dark" ? DARK_PAL : LIGHT_PAL;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 750): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    startRef.current = null;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min((ts - startRef.current) / duration, 1);
      setValue(Math.round((1 - Math.pow(1 - t, 3)) * target));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return value;
}

export function relativeTime(iso: string): string {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); }
  catch { return iso; }
}

export function formatCurrency(val: number | null | undefined): string {
  if (!val) return "₹0";
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(1)}Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(1)}L`;
  if (val >= 1_000) return `₹${(val / 1_000).toFixed(0)}K`;
  return `₹${val.toFixed(0)}`;
}

// ── PremiumTooltip ─────────────────────────────────────────────────────────
export function PremiumTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (value: number, name: string) => string;
}) {
  const p = usePalette();
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: p.CARD_BG,
      boxShadow: "var(--neuo-sm)",
      borderRadius: "14px",
      padding: "10px 14px",
    }}>
      {label && (
        <p style={{ fontSize: "12px", fontWeight: 600, color: p.TEXT_PRIMARY, marginBottom: "6px" }}>{label}</p>
      )}
      {payload.map((entry, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: entry.color || p.ACCENT, flexShrink: 0 }} />
          <span style={{ color: p.TEXT_SECONDARY }}>{entry.name}:</span>
          <span style={{ fontWeight: 700, color: p.TEXT_PRIMARY }}>{formatter ? formatter(entry.value, entry.name) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── GradientBar — burnt sienna → amber gradient, rounded TOP corners only ──
export function GradientBar({ x, y, width, height }: {
  x?: number; y?: number; width?: number; height?: number; fill?: string;
}) {
  const p = usePalette();
  const xv = x ?? 0;
  const yv = y ?? 0;
  const w = Math.max(0, width ?? 0);
  const h = Math.max(0, height ?? 0);
  if (!w || !h) return null;
  const rx = Math.min(5, w / 2);
  const d = `M ${xv + rx} ${yv} L ${xv + w - rx} ${yv} Q ${xv + w} ${yv} ${xv + w} ${yv + rx} L ${xv + w} ${yv + h} L ${xv} ${yv + h} L ${xv} ${yv + rx} Q ${xv} ${yv} ${xv + rx} ${yv} Z`;
  const gradId = `barGrad_${xv}`;
  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.CHART_COLORS[0]} stopOpacity={0.95} />
          <stop offset="100%" stopColor={p.SECONDARY} stopOpacity={0.70} />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${gradId})`} />
    </g>
  );
}

// ── StatCard ────────────────────────────────────────────────────────────────
export interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  description?: string;
  loading?: boolean;
  highlight?: string;
  onClick?: () => void;
  trend?: number;
  glow?: boolean;
}

export function StatCard({ title, value, icon: Icon, description, loading, highlight, onClick, trend, glow }: StatCardProps) {
  const p = usePalette();
  const isNumeric = typeof value === "number";
  const counted = useCountUp(isNumeric ? value : 0);
  const display = isNumeric ? counted.toLocaleString() : value;
  const valueColor = highlight ?? (glow ? p.CHART_COLORS[0] : p.TEXT_PRIMARY);

  return (
    <div
      className={cn("group rounded-[20px] p-5 select-none transition-all duration-200", glow && "stat-card-glow", onClick && "cursor-pointer")}
      style={{ boxShadow: "var(--neuo-shadow)", backgroundColor: p.CARD_BG }}
      onClick={onClick}
      onMouseEnter={e => { if (onClick) { (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--neuo-pressed)"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(1px)"; }}}
      onMouseLeave={e => { if (onClick) { (e.currentTarget as HTMLDivElement).style.boxShadow = ""; (e.currentTarget as HTMLDivElement).style.transform = ""; }}}
    >
      <div className="flex items-center justify-between mb-4">
        <span style={{ fontSize: "13px", fontWeight: 500, color: p.TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {title}
        </span>
        <div className="rounded-xl p-1.5" style={{ background: p.ACCENT_BG }}>
          <Icon className="h-4 w-4" style={{ color: p.ACCENT }} />
        </div>
      </div>

      <div className="flex items-baseline gap-3">
        {loading ? (
          <Skeleton className="h-10 w-24" />
        ) : (
          <div style={{ fontSize: "2.375rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: valueColor }}>
            {display}
          </div>
        )}
        {trend !== undefined && !loading && (
          <span
            className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold shrink-0"
            style={{
              background: trend >= 0 ? p.POS_PILL_BG : p.NEG_PILL_BG,
              color: trend >= 0 ? p.ACCENT : p.NEGATIVE,
            }}
          >
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
        )}
      </div>

      {description && (
        <p className="mt-2 text-sm" style={{ color: p.TEXT_SECONDARY }}>{description}</p>
      )}
    </div>
  );
}

// ── LeaderboardList ────────────────────────────────────────────────────────
interface LeaderboardEntry {
  userId: number;
  userName: string;
  userAvatar?: string | null;
  totalLeads: number;
  wonLeads: number;        // deal wins — primary ranking metric
  wonLeadsCount?: number;  // lead wins — secondary stat shown alongside
  lostLeads?: number;
  activeLeads?: number;
  conversionRate: number | string;       // deal win rate
  leadConversionRate?: number | string;  // lead win rate
}

export function LeaderboardList({ items, onRepClick }: {
  items: LeaderboardEntry[];
  onRepClick?: (userId: number) => void;
}) {
  const p = usePalette();

  const getRingStyle = (rank: number): React.CSSProperties => {
    if (rank === 0) return { boxShadow: `0 0 0 2.5px ${p.ACCENT}`, borderRadius: "50%" };
    if (rank === 1) return { boxShadow: `0 0 0 2px ${p.SECONDARY}`, borderRadius: "50%" };
    if (rank === 2) return { boxShadow: `0 0 0 1.5px ${p.CHART_COLORS[2]}`, borderRadius: "50%" };
    return {};
  };

  return (
    <div className="space-y-1.5">
      {items.slice(0, 8).map((rep, i) => (
        <div
          key={rep.userId}
          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all duration-150 hover:opacity-75 rounded-[12px]"
          style={i < 3 ? { background: p.ROW_BG[i] } : {}}
          onClick={() => onRepClick?.(rep.userId)}
        >
          {/* Rank */}
          <span className="w-5 text-center text-xs font-bold shrink-0 tabular-nums" style={{ color: i < 3 ? p.ACCENT : p.TEXT_SECONDARY }}>
            {i + 1}
          </span>

          {/* Avatar */}
          <div style={getRingStyle(i)}>
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={rep.userAvatar ?? ""} />
              <AvatarFallback className="text-xs">{rep.userName.charAt(0)}</AvatarFallback>
            </Avatar>
          </div>

          {/* Name + two-column stats */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: p.TEXT_PRIMARY }}>{rep.userName}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {/* Lead wins pill */}
              <span
                className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 leading-none"
                style={{ background: p.TRACK_BG }}
              >
                <span style={{ color: p.TEXT_SECONDARY }}>Leads</span>
                <span className="font-bold tabular-nums" style={{ color: p.TEXT_PRIMARY }}>{rep.wonLeadsCount ?? 0}</span>
                <span style={{ color: p.TEXT_SECONDARY }}>won</span>
                <span style={{ color: p.TEXT_SECONDARY, opacity: 0.55 }}>· {rep.leadConversionRate ?? 0}%</span>
              </span>

              {/* Divider */}
              <span style={{ color: p.GRID_COLOR, fontSize: "10px", lineHeight: 1 }}>│</span>

              {/* Deal wins pill — accented, primary ranking metric */}
              <span
                className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 leading-none"
                style={{ background: p.ACCENT_BG }}
              >
                <span style={{ color: p.TEXT_SECONDARY }}>Deals</span>
                <span className="font-bold tabular-nums" style={{ color: p.ACCENT }}>{rep.wonLeads}</span>
                <span style={{ color: p.TEXT_SECONDARY }}>won</span>
                <span style={{ color: p.TEXT_SECONDARY, opacity: 0.55 }}>· {rep.conversionRate}%</span>
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ActivityFeed ───────────────────────────────────────────────────────────
interface ActivityEntry {
  id: number;
  userName?: string | null;
  userAvatar?: string | null;
  description?: string | null;
  createdAt: string;
  leadCompanyName?: string | null;
  leadId?: number | null;
}

export function ActivityFeed({ items, onLeadClick }: {
  items: ActivityEntry[];
  onLeadClick?: (leadId: number) => void;
}) {
  const p = usePalette();
  if (items.length === 0) {
    return <p className="text-center text-sm py-6" style={{ color: p.TEXT_SECONDARY }}>No recent activity.</p>;
  }
  return (
    <div className="relative">
      {/* 1px timeline connector */}
      <div className="absolute left-[18px] top-5 bottom-2" style={{ width: "1px", background: p.GRID_COLOR }} />
      <div className="space-y-4">
        {items.map(a => (
          <div
            key={a.id}
            className={cn("relative flex items-start gap-3", a.leadId && onLeadClick && "cursor-pointer")}
            onClick={() => a.leadId && onLeadClick?.(a.leadId)}
          >
            <Avatar className="h-9 w-9 shrink-0 z-10" style={{ outline: `2px solid hsl(var(--background))` }}>
              <AvatarImage src={a.userAvatar ?? ""} />
              <AvatarFallback className="text-xs">{a.userName?.charAt(0) ?? "U"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm leading-snug">
                <span className="font-semibold" style={{ color: p.TEXT_PRIMARY }}>{a.userName}</span>{" "}
                <span style={{ color: p.TEXT_SECONDARY }}>{a.description}</span>
              </p>
              <p
                className="text-xs mt-0.5"
                style={{ color: p.TEXT_SECONDARY, opacity: 0.7 }}
                title={format(parseISO(a.createdAt), "MMM d, yyyy h:mm a")}
              >
                {relativeTime(a.createdAt)}
                {a.leadCompanyName && (
                  <> · <span style={{ fontWeight: 500, opacity: 1 }}>{a.leadCompanyName}</span></>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FollowUpUrgencyRow ─────────────────────────────────────────────────────
export function FollowUpUrgencyRow({ overdue, dueToday, dueThisWeek, onOverdueClick, onTodayClick, onWeekClick }: {
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  onOverdueClick?: () => void;
  onTodayClick?: () => void;
  onWeekClick?: () => void;
}) {
  const p = usePalette();
  const items = [
    { count: overdue, label: "Overdue", bg: p.OVERDUE_BG, numColor: p.NEGATIVE, onClick: onOverdueClick },
    { count: dueToday, label: "Due Today", bg: p.TODAY_BG, numColor: p.ACCENT, onClick: onTodayClick },
    { count: dueThisWeek, label: "This Week", bg: p.WEEK_BG, numColor: p.SECONDARY, onClick: onWeekClick },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 mb-4">
      {items.map(({ count, label, bg, numColor, onClick }) => (
        <button
          key={label}
          className="rounded-[16px] p-3 text-center transition-all duration-150 hover:opacity-75"
          style={{ background: bg }}
          onClick={onClick}
        >
          <p className="text-xl font-bold tabular-nums" style={{ color: numColor }}>{count}</p>
          <p className="text-[11px] mt-0.5" style={{ color: p.TEXT_SECONDARY }}>{label}</p>
        </button>
      ))}
    </div>
  );
}
