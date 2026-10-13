import { useState } from "react";
import { Activity, Building2, ChevronRight, ChevronLeft, CheckCircle2, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const BUSINESS_TYPES = [
  "Technology", "Finance & Banking", "Healthcare", "Education",
  "Real Estate", "Manufacturing", "Retail & E-commerce", "Consulting",
  "Marketing & Advertising", "Logistics & Supply Chain", "Legal Services",
  "Non-Profit", "Media & Entertainment", "Construction", "Other",
];

const EMPLOYEE_RANGES = ["1–10", "11–50", "51–200", "201–500", "500–1,000", "1,000+"];

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo",
  "Australia/Sydney", "Pacific/Auckland",
];

const CURRENCIES = [
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "JPY", label: "JPY — Japanese Yen" },
];

interface FormData {
  companyName: string;
  businessType: string;
  industry: string;
  employeeCount: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  timezone: string;
  currency: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  confirmPassword: string;
}

const INITIAL: FormData = {
  companyName: "", businessType: "", industry: "", employeeCount: "",
  email: "", phone: "", website: "", address: "", timezone: "UTC", currency: "INR",
  adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "", confirmPassword: "",
};

const STEPS = [
  { label: "Company Info",    desc: "Tell us about your business" },
  { label: "Contact Details", desc: "How can we reach you?" },
  { label: "Admin Account",   desc: "Create your login credentials" },
];

export default function WorkspaceNew() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);

  function set(field: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function validateStep1(): boolean {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.companyName.trim()) e.companyName = "Company name is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2(): boolean {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.email.trim()) e.email = "Business email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Enter a valid email";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep3(): boolean {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.adminFirstName.trim()) e.adminFirstName = "First name is required";
    if (!form.adminLastName.trim()) e.adminLastName = "Last name is required";
    if (!form.adminEmail.trim()) e.adminEmail = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) e.adminEmail = "Enter a valid email";
    if (!form.adminPassword) e.adminPassword = "Password is required";
    else if (form.adminPassword.length < 8) e.adminPassword = "At least 8 characters";
    if (form.adminPassword !== form.confirmPassword) e.confirmPassword = "Passwords do not match";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    const valid = step === 1 ? validateStep1() : step === 2 ? validateStep2() : false;
    if (valid) setStep(s => s + 1);
  }

  function back() {
    setErrors({});
    setStep(s => s - 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep3()) return;
    setSubmitting(true);
    setApiError("");
    try {
      const res = await fetch(`${BASE}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setApiError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      // Clear stale auth cache and dev token so the new session cookie is
      // used cleanly on the next page load — avoids blank screen from stale state.
      try { sessionStorage.removeItem("__auth_user_v1"); } catch { /* ignore */ }
      try { sessionStorage.removeItem("__dev_sid"); } catch { /* ignore */ }
      window.location.href = `${BASE}/dashboard`;
    } catch {
      setApiError("Network error. Please check your connection.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--brand-light))] p-4">
      <div className="w-full max-w-lg">
        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <div className="h-16 w-16 bg-primary rounded-2xl flex items-center justify-center mb-4 shadow-xl shadow-primary/30">
            <Activity className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Create Your CRM Workspace</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Set up your independent Rapport workspace
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0 mb-6">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <div key={n} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    done ? "bg-primary text-primary-foreground" :
                    active ? "bg-primary text-primary-foreground ring-4 ring-primary/20" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : n}
                  </div>
                  <span className={`text-xs mt-1 font-medium hidden sm:block ${active ? "text-primary" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-px w-12 sm:w-16 mx-1 mb-4 sm:mb-5 transition-colors ${n < step ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-card border shadow-md rounded-2xl p-8">
          <div className="mb-6">
            <p className="font-semibold text-base">{STEPS[step - 1]?.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{STEPS[step - 1]?.desc}</p>
          </div>

          {/* ── Step 1: Company Info ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Company Name <span className="text-destructive">*</span></Label>
                <Input
                  autoFocus
                  placeholder="Acme Corp"
                  value={form.companyName}
                  onChange={e => set("companyName", e.target.value)}
                />
                {errors.companyName && <p className="text-xs text-destructive">{errors.companyName}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Business Type</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={form.businessType}
                    onChange={e => set("businessType", e.target.value)}
                  >
                    <option value="">Select type…</option>
                    {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Industry</Label>
                  <Input
                    placeholder="e.g. SaaS, Healthcare…"
                    value={form.industry}
                    onChange={e => set("industry", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Number of Employees</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={form.employeeCount}
                  onChange={e => set("employeeCount", e.target.value)}
                >
                  <option value="">Select range…</option>
                  {EMPLOYEE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <Button className="w-full py-5 text-base mt-2" onClick={next}>
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* ── Step 2: Contact & Settings ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Business Email <span className="text-destructive">*</span></Label>
                <Input
                  autoFocus
                  type="email"
                  placeholder="hello@yourcompany.com"
                  value={form.email}
                  onChange={e => set("email", e.target.value)}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Business Phone</Label>
                  <Input
                    placeholder="+1 555-000-0000"
                    value={form.phone}
                    onChange={e => set("phone", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Website</Label>
                  <Input
                    placeholder="https://yourcompany.com"
                    value={form.website}
                    onChange={e => set("website", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Company Address</Label>
                <Input
                  placeholder="123 Main St, City, Country"
                  value={form.address}
                  onChange={e => set("address", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Time Zone</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={form.timezone}
                    onChange={e => set("timezone", e.target.value)}
                  >
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Currency</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={form.currency}
                    onChange={e => set("currency", e.target.value)}
                  >
                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-2">
                <Button variant="outline" className="flex-1 py-5" onClick={back}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button className="flex-1 py-5 text-base" onClick={next}>
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Admin Account ── */}
          {step === 3 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First Name <span className="text-destructive">*</span></Label>
                  <Input
                    autoFocus
                    placeholder="Jane"
                    value={form.adminFirstName}
                    onChange={e => set("adminFirstName", e.target.value)}
                  />
                  {errors.adminFirstName && <p className="text-xs text-destructive">{errors.adminFirstName}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="Smith"
                    value={form.adminLastName}
                    onChange={e => set("adminLastName", e.target.value)}
                  />
                  {errors.adminLastName && <p className="text-xs text-destructive">{errors.adminLastName}</p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Work Email <span className="text-destructive">*</span></Label>
                <Input
                  type="email"
                  placeholder="jane@yourcompany.com"
                  value={form.adminEmail}
                  onChange={e => set("adminEmail", e.target.value)}
                />
                {errors.adminEmail && <p className="text-xs text-destructive">{errors.adminEmail}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Password <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    type={showPw ? "text" : "password"}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    value={form.adminPassword}
                    onChange={e => set("adminPassword", e.target.value)}
                  />
                  <button type="button" tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPw(v => !v)}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.adminPassword && <p className="text-xs text-destructive">{errors.adminPassword}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Confirm Password <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    type={showCpw ? "text" : "password"}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={e => set("confirmPassword", e.target.value)}
                  />
                  <button type="button" tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCpw(v => !v)}>
                    {showCpw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword}</p>}
              </div>

              {apiError && (
                <p className="text-sm text-destructive" role="alert">{apiError}</p>
              )}

              <div className="flex gap-3 mt-2">
                <Button type="button" variant="outline" className="flex-1 py-5" onClick={back} disabled={submitting}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button type="submit" variant="cta" className="flex-1 py-5 text-base" disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating workspace…</>
                  ) : (
                    "Launch My CRM"
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Summary card for steps 2+ */}
        {step > 1 && form.companyName && (
          <div className="mt-4 bg-card border rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{form.companyName}</p>
              {form.businessType && <p className="text-xs text-muted-foreground">{form.businessType}</p>}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-5 opacity-60">
          Already have an account?{" "}
          <a href={`${BASE}/login`} className="hover:text-primary hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  );
}
