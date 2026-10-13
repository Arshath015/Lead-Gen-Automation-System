import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetMyWidgets } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  LayoutDashboard, 
  Users, 
  BarChart3, 
  Settings, 
  LogOut,
  UserCog,
  ShieldAlert,
  CalendarDays,
  Shield,
  UserRound,
  Building2,
  Handshake,
  Menu,
  UserCheck,
  FileUp,
  RefreshCw,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/use-permission";

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, widgetKey: "nav_dashboard", permission: "dashboard.view" },
  { href: "/leads", label: "Leads", icon: Users, widgetKey: "nav_leads", permission: "leads.view" },
  { href: "/import", label: "Import Leads", icon: FileUp, widgetKey: null, permission: "leads.import" },
  { href: "/contacts", label: "Contacts", icon: UserRound, widgetKey: null, permission: "contacts.view" },
  { href: "/accounts", label: "Accounts", icon: Building2, widgetKey: null, permission: "contacts.view" },
  { href: "/deals", label: "Deals", icon: Handshake, widgetKey: null, permission: "deals.view" },
  { href: "/activities", label: "Activities", icon: CalendarDays, widgetKey: null, permission: "activities.view" },
  { href: "/reports", label: "Reports", icon: BarChart3, widgetKey: "nav_reports", permission: "reports.view" },
  { href: "/users", label: "Team", icon: UserCog, widgetKey: "nav_users", permission: "users.view" },
  { href: "/roles", label: "Roles & Permissions", icon: Shield, widgetKey: "nav_roles", permission: "roles.view" },
  { href: "/audit", label: "Audit Log", icon: ShieldAlert, widgetKey: "nav_audit", permission: "audit.view" },
  { href: "/approvals", label: "Account Approvals", icon: UserCheck, widgetKey: "nav_approvals", permission: "approvals.view" },
  { href: "/settings", label: "Settings", icon: Settings, widgetKey: null, permission: null },
];

const FALLBACK_ROLES: Record<string, string[]> = {
  nav_dashboard: ["admin", "manager", "bd"],
  nav_leads: ["admin", "manager", "bd"],
  nav_reports: ["admin", "manager"],
  nav_users: ["admin"],
  nav_roles: ["admin"],
  nav_audit: ["admin"],
  nav_approvals: ["admin"],
};

function NavContent({ items, location, onNavigate, collapsed = false, onToggleCollapse }: {
  items: typeof NAV_ITEMS;
  location: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, logout } = useAuth();
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col h-full">
        {/* Logo lockup */}
        <div
          className={`h-16 flex items-center gap-2.5 border-b shrink-0 ${collapsed ? "justify-center px-0" : "justify-center px-4"}`}
          style={{background: "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)"}}
        >
          <img src="/rapport-logo.svg" alt="Rapport" className="h-9 w-auto shrink-0" />
          {!collapsed && <span className="text-white font-bold text-lg tracking-tight">Rapport</span>}
        </div>

        <nav
          className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Main navigation"
        >
          {items.map((item) => {
            const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href));
            const link = (
              <Link key={item.href} href={item.href} onClick={onNavigate}>
                <div className={`flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  ${collapsed
                    ? (isActive ? "bg-brand-light text-primary" : "text-muted-foreground hover:bg-brand-light/60 hover:text-primary") + " justify-center px-0"
                    : (isActive
                        ? "bg-brand-light text-primary border-l-[3px] border-primary pl-[calc(0.75rem-3px)]"
                        : "text-muted-foreground hover:bg-brand-light/60 hover:text-primary border-l-[3px] border-transparent pl-[calc(0.75rem-3px)]")
                  }
                `}
                >
                  <item.icon className={`h-5 w-5 shrink-0 ${collapsed ? "" : "mr-3"} ${isActive ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                  {!collapsed && item.label}
                </div>
              </Link>
            );
            if (!collapsed) return link;
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="left">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <div className={`p-4 border-t shrink-0 ${collapsed ? "px-2" : ""}`}>
          {onToggleCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className={`hidden lg:flex w-full text-muted-foreground mb-3 ${collapsed ? "justify-center px-0" : "justify-start"}`}
                  onClick={onToggleCollapse}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {collapsed ? <PanelRightOpen className="h-4 w-4" aria-hidden="true" /> : <PanelRightClose className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {!collapsed && "Collapse"}
                </Button>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="left">Expand sidebar</TooltipContent>}
            </Tooltip>
          )}

          <div className={`flex items-center gap-3 mb-4 ${collapsed ? "justify-center" : ""}`}>
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={user?.profileImage || ""} alt={user?.username ?? ""} />
              <AvatarFallback className="bg-primary text-primary-foreground">{user?.username?.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="overflow-hidden">
                <p className="text-sm font-medium truncate">{user?.username}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
              </div>
            )}
          </div>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="w-full" onClick={() => logout()} aria-label="Sign out">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Sign out</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={() => logout()} aria-label="Sign out">
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

const SIDEBAR_COLLAPSE_KEY = "rapport.sidebarCollapsed";
const SIDEBAR_WIDTH_KEY = "rapport.sidebarWidth";
const COLLAPSED_WIDTH = 72;
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1");
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      const next = window.innerWidth - e.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
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
  const queryClient = useQueryClient();
  const { data: myWidgets, isSuccess: widgetsLoaded } = useGetMyWidgets();
  const { has, isSuperAdmin } = usePermissions();

  const widgetList = myWidgets?.widgets ?? [];
  const visibleWidgetKeys: Set<string> | null = widgetsLoaded && widgetList.length > 0
    ? new Set(widgetList.map(w => w.widgetKey))
    : null;

  const visibleNav = NAV_ITEMS.filter(item => {
    // Settings has no permission gate (always visible) — explicitly hidden from
    // the curated demo tour since its backend isn't part of the mock.
    if (DEMO_MODE && item.href === "/settings") return false;

    // Permission gate — superadmins bypass; null permission = always show (e.g. Settings)
    if (item.permission && !isSuperAdmin && !has(item.permission)) return false;

    // Widget system customization (further restricts if the admin has configured widget visibility)
    if (item.widgetKey !== null && visibleWidgetKeys !== null) {
      return visibleWidgetKeys.has(item.widgetKey);
    }
    // Fallback role check for widget-keyed items before widgets load
    if (item.widgetKey !== null) {
      const allowedRoles = FALLBACK_ROLES[item.widgetKey] ?? [];
      return allowedRoles.includes(user?.role || "");
    }
    return true;
  });

  const currentPageLabel = visibleNav.find(n => location === n.href || (n.href !== "/dashboard" && location.startsWith(n.href)))?.label || "Overview";

  return (
    <div className="flex h-screen bg-[#F5F6F8] dark:bg-[#12141A]">
      {/* Main Content — comes first in DOM order so the sidebar sits on the right */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-16 border-b bg-card flex items-center justify-between px-4 md:px-8 shrink-0">
          <h2 className="text-base md:text-lg font-semibold text-primary">{currentPageLabel}</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              disabled={refreshing}
              aria-label="Refresh data"
              onClick={async () => {
                setRefreshing(true);
                await queryClient.refetchQueries({ type: "active" });
                setRefreshing(false);
              }}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            </Button>
            <ThemeToggle />
            <NotificationBell />
            {/* Hamburger — mobile only, opens the nav drawer from the right */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-9 w-9"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>

      {/* Resize handle — sits on the sidebar's left edge since it's docked right */}
      {!collapsed && (
        <div
          onMouseDown={() => setResizing(true)}
          className="hidden w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 lg:block"
        />
      )}

      {/* Desktop Sidebar */}
      <aside
        style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
        className={`hidden lg:flex border-l bg-card flex-col shrink-0 ${resizing ? "" : "transition-[width] duration-200 ease-in-out"}`}
      >
        <NavContent items={visibleNav} location={location} collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      </aside>

      {/* Mobile Sidebar Sheet — slides in from the right, matching the desktop sidebar's side */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="p-0 w-72 max-w-[85vw]">
          <NavContent
            items={visibleNav}
            location={location}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
