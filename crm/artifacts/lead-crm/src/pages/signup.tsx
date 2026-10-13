import { useState } from "react";
import { Activity, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Signup() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    company: "",
    requestedRole: "bd" as "manager" | "bd",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sign-up failed. Please try again.");
      } else {
        setDone(true);
      }
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--brand-light))] p-4">
        <div className="w-full max-w-md text-center">
          <div className="h-20 w-20 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-xl shadow-primary/30">
            <Activity className="h-10 w-10 text-primary-foreground" />
          </div>
          <div className="bg-card border shadow-md rounded-2xl p-8">
            <div className="text-4xl mb-4">🎉</div>
            <h2 className="text-xl font-bold mb-2">Request submitted!</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Your account request has been sent to the admin for approval. You'll receive an email once it's reviewed.
            </p>
            <a href={`${BASE}/login`}>
              <Button variant="outline" className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Login
              </Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--brand-light))] p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/rapport-logo.svg" alt="Rapport" className="h-16 w-auto mb-4 drop-shadow-md" />
          <p className="text-muted-foreground mt-2 text-sm">Create a new account</p>
        </div>

        <div className="bg-card border shadow-md rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  autoFocus
                  value={form.firstName}
                  onChange={e => setForm({ ...form, firstName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={e => setForm({ ...form, lastName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company">Company / Team <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="company"
                value={form.company}
                onChange={e => setForm({ ...form, company: e.target.value })}
                placeholder="e.g. Acme Sales"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="requestedRole">Requested role</Label>
              <Select
                value={form.requestedRole}
                onValueChange={v => setForm({ ...form, requestedRole: v as "manager" | "bd" })}
              >
                <SelectTrigger id="requestedRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bd">Sales Person</SelectItem>
                  <SelectItem value="manager">Sales Manager</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The admin will confirm your final role on approval.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(s => !s)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">At least 8 characters</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirm(s => !s)}
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            )}

            <Button variant="cta" type="submit" className="w-full py-5 text-base" disabled={loading}>
              {loading ? "Submitting…" : "Request Account"}
            </Button>

            <div className="text-center text-sm">
              Already have an account?{" "}
              <a href={`${BASE}/login`} className="text-primary hover:underline font-medium">Sign in</a>
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 opacity-60">
          Rapport CRM
        </p>
      </div>
    </div>
  );
}
