import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Target,
  Settings as SettingsIcon,
  Sparkles,
  RefreshCcw,
  Wifi,
  WifiOff,
  UploadCloud,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useHealth } from "../lib/useHealth";
import { Tooltip } from "./ui/Tooltip";

export type View = "dashboard" | "leads" | "icp" | "import" | "crm" | "settings";

interface Props {
  children: ReactNode;
  view: View;
  onNavigate: (view: View) => void;
}

const NAV_ITEMS: { key: View; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "leads", label: "Leads", icon: Users },
  { key: "icp", label: "ICP Profiles", icon: Target },
  { key: "import", label: "Import", icon: UploadCloud },
  { key: "crm", label: "Rapport", icon: Building2 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

const COLLAPSE_STORAGE_KEY = "outreach.sidebarCollapsed";
const WIDTH_STORAGE_KEY = "outreach.sidebarWidth";
const COLLAPSED_WIDTH = 68;
const DEFAULT_WIDTH = 248;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

export function AppShell({ children, view, onNavigate }: Props) {
  const healthy = useHealth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  }, [width]);

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX)));
    }
    function onUp() {
      setResizing(false);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  useEffect(() => {
    document.body.style.cursor = resizing ? "col-resize" : "";
    document.body.style.userSelect = resizing ? "none" : "";
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas">
      {/* Deliberately its own dark surface, not a tint of the workspace
          canvas — the contrast is what separates "navigation" from
          "content" without needing another bordered box. */}
      <aside
        style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
        className={cn(
          "flex shrink-0 flex-col bg-ink-900",
          !resizing && "transition-[width] duration-200 ease-in-out"
        )}
      >
        <div className={cn("flex h-16 shrink-0 items-center gap-2.5 px-5", collapsed && "justify-center px-0")}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-600 shadow-[0_2px_8px_rgba(79,70,229,0.5)]">
            <Sparkles className="size-4 text-white" />
          </div>
          {!collapsed && <span className="truncate text-[15px] font-bold tracking-tight text-white">Outreach</span>}
        </div>

        <nav className="flex-1 space-y-1 px-3 pt-3">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
            const active = view === key;
            const button = (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  active ? "bg-accent-600 text-white shadow-[0_2px_10px_rgba(79,70,229,0.45)]" : "text-white/55 hover:bg-white/[0.06] hover:text-white/90"
                )}
              >
                <Icon className="size-[17px] shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </button>
            );
            return collapsed ? (
              <Tooltip key={key} label={label} side="right">
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </nav>

        <div className="border-t border-white/[0.07] px-3 py-3">
          <Tooltip label="Reload app" side="right">
            <button
              onClick={() => location.reload()}
              className={cn(
                "mb-1 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/90",
                collapsed && "justify-center px-0"
              )}
            >
              <RefreshCcw className="size-[17px] shrink-0" />
              {!collapsed && <span className="truncate">Reload app</span>}
            </button>
          </Tooltip>

          <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
            <button
              onClick={() => setCollapsed((c) => !c)}
              className={cn(
                "mb-2 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/90",
                collapsed && "justify-center px-0"
              )}
            >
              {collapsed ? <PanelLeftOpen className="size-[17px] shrink-0" /> : <PanelLeftClose className="size-[17px] shrink-0" />}
              {!collapsed && <span className="truncate">Collapse</span>}
            </button>
          </Tooltip>

          <div className={cn("flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3 py-2.5", collapsed && "justify-center px-0 py-2")}>
            {DEMO_MODE ? (
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
            ) : healthy === null ? (
              <span className="size-1.5 shrink-0 rounded-full bg-white/30" />
            ) : healthy ? (
              <Wifi className="size-3.5 shrink-0 text-emerald-400" />
            ) : (
              <WifiOff className="size-3.5 shrink-0 text-red-400" />
            )}
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-medium text-white/85">
                  {DEMO_MODE ? "Demo mode" : healthy === null ? "Checking…" : healthy ? "Backend connected" : "Backend unreachable"}
                </p>
                <p className="truncate text-[10.5px] text-white/35">{DEMO_MODE ? "Sample data, nothing real is sent" : "localhost:4000"}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {!collapsed && (
        <div
          onMouseDown={() => setResizing(true)}
          className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent-600/50 active:bg-accent-600"
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
