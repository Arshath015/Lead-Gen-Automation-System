import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Redirect } from "wouter";
import { Eye, EyeOff, Building2, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Login() {
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();

  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [setupData, setSetupData] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [setupError, setSetupError] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);

  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/auth/setup-needed`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setNeedsSetup(data.needsSetup ?? false))
      .catch(() => {})
      .finally(() => setCheckingSetup(false));
  }, []);

  if (isLoading || checkingSetup) return (
    <div className="min-h-screen bg-[hsl(var(--brand-light))] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
  if (isAuthenticated) return <Redirect to="/dashboard" />;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
        credentials: "include",
        body: JSON.stringify(loginData),
      });
      const data = (await res.json()) as { error?: string; mustChangePassword?: boolean };
      if (!res.ok) {
        setLoginError(data.error ?? "Login failed. Please try again.");
      } else {
        if (data.mustChangePassword) {
          window.location.href = `${BASE}/force-change-password`;
        } else {
          await queryClient.invalidateQueries();
          window.location.href = `${BASE}/dashboard`;
        }
      }
    } catch {
      setLoginError("Network error. Please check your connection and try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setSetupError("");
    setSetupLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
        credentials: "include",
        body: JSON.stringify(setupData),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSetupError(data.error ?? "Setup failed. Please try again.");
      } else {
        await queryClient.invalidateQueries();
        window.location.href = `${BASE}/dashboard`;
      }
    } catch {
      setSetupError("Network error. Please check your connection and try again.");
    } finally {
      setSetupLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--brand-light))] p-4">
      <div className="w-full max-w-md">
        {/* Brand hero */}
        <div className="flex flex-col items-center mb-8">
          <img src="/rapport-logo.svg" alt="Rapport" className="h-20 w-auto mb-3 mt-4 drop-shadow-md" />
          <h1 className="text-2xl font-extrabold tracking-tight">Rapport</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {needsSetup ? "Create your admin account to get started" : "Sign in to your cockpit"}
          </p>
        </div>

        <div className="bg-card border shadow-md rounded-2xl p-8">
          {needsSetup ? (
            /* ── First-run setup form ── */
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="mb-2">
                <p className="font-semibold text-sm">Set up Rapport</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No accounts exist yet. Create the first admin account.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="setupFirst">First name</Label>
                  <Input
                    id="setupFirst"
                    autoFocus
                    value={setupData.firstName}
                    onChange={(e) => setSetupData({ ...setupData, firstName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="setupLast">Last name</Label>
                  <Input
                    id="setupLast"
                    value={setupData.lastName}
                    onChange={(e) => setSetupData({ ...setupData, lastName: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="setupEmail">Email</Label>
                <Input
                  id="setupEmail"
                  type="email"
                  autoComplete="email"
                  value={setupData.email}
                  onChange={(e) => setSetupData({ ...setupData, email: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="setupPassword">Password</Label>
                <div className="relative">
                  <Input
                    id="setupPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={setupData.password}
                    onChange={(e) => setSetupData({ ...setupData, password: e.target.value })}
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">At least 8 characters</p>
              </div>

              {setupError && (
                <p className="text-sm text-destructive" role="alert">{setupError}</p>
              )}

              <Button variant="cta" type="submit" className="w-full py-5 text-base" disabled={setupLoading}>
                {setupLoading ? "Creating account…" : "Create Admin Account"}
              </Button>
            </form>
          ) : (
            /* ── Login form ── */
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={loginData.email}
                  onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <a
                    href={`${BASE}/forgot-password`}
                    className="text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={loginData.password}
                    onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {loginError && (
                <p className="text-sm text-destructive" role="alert">{loginError}</p>
              )}

              <Button type="submit" className="w-full py-5 text-base" disabled={loginLoading}>
                {loginLoading ? "Signing in…" : "Sign In"}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                Part of a team?{" "}
                <a href={`${BASE}/signup`} className="text-primary hover:underline font-medium">Request access</a>
              </div>

              <div className="relative flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <a href={`${BASE}/workspace/new`} className="block">
                <Button type="button" variant="outline" className="w-full py-5 border-primary/40 hover:border-primary hover:bg-primary/5 group">
                  <Building2 className="h-4 w-4 mr-2 text-primary group-hover:scale-110 transition-transform" />
                  <span className="text-sm font-medium">Create New CRM Workspace</span>
                </Button>
              </a>

              {/* Quick Dev Login only ever works inside an actual Replit
                  workspace (server-side gated on REPLIT_DEV_DOMAIN) — not
                  reachable from this local setup, so it's not rendered here
                  rather than showing a button that always fails. */}
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 opacity-60">
          Rapport CRM
        </p>
      </div>
    </div>
  );
}
