import { useEffect, useState } from "react";
import {
  X,
  Pencil,
  ExternalLink,
  MapPin,
  Building2,
  KeyRound,
  CheckCircle2,
  Circle,
  ChevronDown,
  Trash2,
  Calendar,
  Globe,
  Phone as PhoneIcon,
  Target,
} from "lucide-react";
import { Sheet } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Avatar } from "../../components/ui/Avatar";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Switch } from "../../components/ui/Switch";
import { inputClass, labelClass } from "../../components/ui/field";
import { LeadStatusBadge, EngagementStatusBadge } from "./StatusBadges";
import { ResearchPanel } from "./ResearchPanel";
import { EmailComposer } from "./EmailComposer";
import { ActivityTimeline } from "./ActivityTimeline";
import { EmailHistoryTimeline } from "./EmailHistoryTimeline";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import { cn } from "../../lib/cn";
import { formatAbsoluteDateTime, formatRelativeTime } from "../../lib/format";
import type { EmailDraft, EngagementStatus, IcpProfile, Lead, LeadStatus, ResearchBrief } from "../../types";

type Tab = "overview" | "research" | "email" | "tracking" | "activity";

interface Props {
  lead: Lead;
  emailFrom: string | null;
  icpProfiles: IcpProfile[];
  initialTab?: Tab;
  onClose: () => void;
  onLeadChanged: (lead: Lead) => void;
  onDeleted: (id: string) => void;
}

export function LeadDetailSheet({ lead, emailFrom, icpProfiles, initialTab, onClose, onLeadChanged, onDeleted }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialTab ?? "overview");
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [sendingToCrm, setSendingToCrm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fullName, setFullName] = useState(lead.fullName);
  const [title, setTitle] = useState(lead.title ?? "");
  const [company, setCompany] = useState(lead.company ?? "");
  const [companyDomain, setCompanyDomain] = useState(lead.companyDomain ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(lead.linkedinUrl ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [location, setLocation] = useState(lead.location ?? "");
  const [icpProfileId, setIcpProfileId] = useState(lead.icpProfileId ?? "");

  async function load() {
    setLoading(true);
    try {
      const [b, d] = await Promise.all([api.getResearchBrief(lead.id), api.getEmailDraft(lead.id)]);
      setBrief(b);
      setDraft(d);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    setFullName(lead.fullName);
    setTitle(lead.title ?? "");
    setCompany(lead.company ?? "");
    setCompanyDomain(lead.companyDomain ?? "");
    setEmail(lead.email ?? "");
    setLinkedinUrl(lead.linkedinUrl ?? "");
    setPhone(lead.phone ?? "");
    setLocation(lead.location ?? "");
    setIcpProfileId(lead.icpProfileId ?? "");
    setEditing(false);
    setTab(initialTab ?? "overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  async function handleReveal() {
    setRevealing(true);
    try {
      const updated = await api.revealLead(lead.id);
      onLeadChanged(updated);
      toast.push({ variant: "success", title: "Email revealed" });
    } catch (e) {
      toast.push({ variant: "error", title: "Reveal failed", description: (e as Error).message });
    } finally {
      setRevealing(false);
    }
  }

  async function handleSendToCrm() {
    setSendingToCrm(true);
    try {
      const updated = await api.sendLeadToCrm(lead.id);
      onLeadChanged(updated);
      toast.push({ variant: "success", title: "Sent to CRM" });
    } catch (e) {
      toast.push({ variant: "error", title: "Send to CRM failed", description: (e as Error).message });
    } finally {
      setSendingToCrm(false);
    }
  }

  async function handleSaveOverview() {
    setSaving(true);
    try {
      const updated = await api.updateLead(lead.id, {
        fullName,
        title: title || null,
        company: company || null,
        companyDomain: companyDomain || null,
        email: email || null,
        linkedinUrl: linkedinUrl || null,
        phone: phone || null,
        location: location || null,
        icpProfileId: icpProfileId || null,
      });
      onLeadChanged(updated);
      setEditing(false);
      toast.push({ variant: "success", title: "Lead updated" });
    } catch (e) {
      toast.push({ variant: "error", title: "Update failed", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: LeadStatus) {
    try {
      const updated = await api.updateLead(lead.id, { status });
      onLeadChanged(updated);
    } catch (e) {
      toast.push({ variant: "error", title: "Status update failed", description: (e as Error).message });
    }
  }

  async function handleEngagementChange(engagementStatus: EngagementStatus) {
    try {
      const updated = await api.updateLead(lead.id, { engagementStatus });
      onLeadChanged(updated);
      toast.push({
        variant: "info",
        title: engagementStatus === "active" ? "Automation re-enabled" : "Automation stopped for this lead",
        description:
          engagementStatus !== "active" ? "Any pending follow-ups have been cancelled." : undefined,
      });
    } catch (e) {
      toast.push({ variant: "error", title: "Update failed", description: (e as Error).message });
    }
  }

  async function handleAutomationToggle(enabled: boolean) {
    try {
      const updated = await api.updateLead(lead.id, { automationEnabled: enabled });
      onLeadChanged(updated);
    } catch (e) {
      toast.push({ variant: "error", title: "Update failed", description: (e as Error).message });
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteLead(lead.id);
      onDeleted(lead.id);
      toast.push({ variant: "success", title: `${lead.fullName} deleted` });
    } catch (e) {
      toast.push({ variant: "error", title: "Delete failed", description: (e as Error).message });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const researchComplete = brief?.status === "complete";
  const steps: { label: string; done: boolean }[] = [
    { label: "Found", done: true },
    { label: "Qualified", done: lead.status === "qualified" },
    { label: "Email", done: !!lead.email },
    { label: "Research", done: researchComplete },
    { label: "Draft", done: !!draft },
    { label: "Sent", done: draft?.sendStatus === "sent" },
  ];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={lead.fullName} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">{lead.fullName}</p>
            <p className="truncate text-xs text-gray-500">
              {[lead.title, lead.company].filter(Boolean).join(" @ ") || "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <EngagementSelect status={lead.engagementStatus} onChange={handleEngagementChange} />
          <StatusSelect status={lead.status} onChange={handleStatusChange} />
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
            title="Delete lead"
          >
            <Trash2 className="size-4" />
          </button>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-2.5">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1.5">
            {s.done ? (
              <CheckCircle2 className="size-3.5 text-emerald-500" />
            ) : (
              <Circle className="size-3.5 text-gray-200" />
            )}
            <span className={cn("text-[11px] font-medium", s.done ? "text-gray-600" : "text-gray-300")}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="h-px w-3 bg-gray-200" />}
          </div>
        ))}
      </div>

      <div className="flex border-b border-border-subtle px-5">
        {(["overview", "research", "email", "tracking", "activity"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "relative px-3 py-2.5 text-[13px] font-semibold capitalize transition-colors",
              tab === t ? "text-accent-700" : "text-gray-400 hover:text-gray-600"
            )}
          >
            {t}
            {tab === t && <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent-600" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <p className="py-8 text-center text-xs text-gray-400">Loading…</p>
        ) : (
          <>
            {tab === "overview" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-bold text-ink">Details</h3>
                  {!editing ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="primary" onClick={handleSaveOverview} loading={saving}>
                        Save
                      </Button>
                    </div>
                  )}
                </div>

                {editing ? (
                  <div className="space-y-2.5">
                    <div>
                      <label className={labelClass}>Full name</label>
                      <input className={inputClass + " mt-1"} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className={labelClass}>Title</label>
                        <input className={inputClass + " mt-1"} value={title} onChange={(e) => setTitle(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Company</label>
                        <input className={inputClass + " mt-1"} value={company} onChange={(e) => setCompany(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Company domain</label>
                        <input className={inputClass + " mt-1"} value={companyDomain} onChange={(e) => setCompanyDomain(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Location</label>
                        <input className={inputClass + " mt-1"} value={location} onChange={(e) => setLocation(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Email</label>
                        <input type="email" className={inputClass + " mt-1"} value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Phone</label>
                        <input className={inputClass + " mt-1"} value={phone} onChange={(e) => setPhone(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>LinkedIn URL</label>
                      <input className={inputClass + " mt-1"} value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelClass}>ICP profile</label>
                      <select
                        className={inputClass + " mt-1"}
                        value={icpProfileId}
                        onChange={(e) => setIcpProfileId(e.target.value)}
                      >
                        <option value="">None</option>
                        {icpProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5 rounded-2xl border border-border-subtle p-4">
                    <Row icon={<Building2 className="size-3.5" />} label="Company" value={lead.company} />
                    <Row icon={<Globe className="size-3.5" />} label="Domain" value={lead.companyDomain} />
                    <Row icon={<MapPin className="size-3.5" />} label="Location" value={lead.location} />
                    <Row icon={<PhoneIcon className="size-3.5" />} label="Phone" value={lead.phone} />
                    <Row
                      icon={<KeyRound className="size-3.5" />}
                      label="Email"
                      value={
                        lead.email ?? (
                          <button
                            onClick={handleReveal}
                            disabled={revealing}
                            title="Spends 1 Apollo lead credit"
                            className="text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-40"
                          >
                            {revealing ? "Revealing…" : "Reveal email"}
                          </button>
                        )
                      }
                    />
                    {lead.linkedinUrl && (
                      <Row
                        icon={<ExternalLink className="size-3.5" />}
                        label="LinkedIn"
                        value={
                          <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="text-accent-600 hover:underline">
                            View profile
                          </a>
                        }
                      />
                    )}
                    <Row
                      icon={<Target className="size-3.5" />}
                      label="ICP"
                      value={icpProfiles.find((p) => p.id === lead.icpProfileId)?.name ?? null}
                    />
                    <Row label="Source" value={<span className="capitalize">{lead.source}</span>} />
                    <Row
                      icon={<Building2 className="size-3.5" />}
                      label="CRM"
                      value={
                        lead.crmLeadId ? (
                          <span className="text-xs font-medium text-emerald-600">In CRM (#{lead.crmLeadId})</span>
                        ) : (
                          <button
                            onClick={handleSendToCrm}
                            disabled={sendingToCrm}
                            title="Creates a new lead in the CRM"
                            className="text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-40"
                          >
                            {sendingToCrm ? "Sending…" : "Send to CRM"}
                          </button>
                        )
                      }
                    />
                    <Row
                      icon={<Calendar className="size-3.5" />}
                      label="Created"
                      value={
                        <span title={formatAbsoluteDateTime(lead.createdAt)}>
                          {formatAbsoluteDateTime(lead.createdAt)} ({formatRelativeTime(lead.createdAt)})
                        </span>
                      }
                    />
                  </div>
                )}

                <div className="flex items-center justify-between rounded-2xl border border-border-subtle p-4">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">Automation for this lead</p>
                    <p className="text-xs text-gray-400">
                      {lead.engagementStatus !== "active"
                        ? "Disabled automatically — engagement status is not active"
                        : "Included in automatic draft/send/follow-up when those are enabled globally"}
                    </p>
                  </div>
                  <Switch
                    checked={lead.automationEnabled && lead.engagementStatus === "active"}
                    disabled={lead.engagementStatus !== "active"}
                    onChange={handleAutomationToggle}
                    ariaLabel="Automation for this lead"
                  />
                </div>
              </div>
            )}

            {tab === "research" && <ResearchPanel leadId={lead.id} brief={brief} onChanged={setBrief} />}

            {tab === "email" && (
              <EmailComposer
                lead={lead}
                draft={draft}
                researchComplete={researchComplete}
                emailFrom={emailFrom}
                onChanged={setDraft}
              />
            )}

            {tab === "tracking" && <EmailHistoryTimeline lead={lead} />}

            {tab === "activity" && <ActivityTimeline leadId={lead.id} />}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this lead?"
        description={`${lead.fullName} and all of its research/draft/send history will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </Sheet>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-gray-400">
        {icon}
        {label}
      </span>
      <span className="min-w-0 truncate text-gray-700">{value ?? "—"}</span>
    </div>
  );
}

const ENGAGEMENT_OPTIONS: EngagementStatus[] = ["active", "replied", "bounced", "unsubscribed", "not_interested"];
const ENGAGEMENT_LABELS: Record<EngagementStatus, string> = {
  active: "Active",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  not_interested: "Not interested",
};

function EngagementSelect({ status, onChange }: { status: EngagementStatus; onChange: (s: EngagementStatus) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-gray-50"
        title="Engagement status — anything other than Active stops automation for this lead"
      >
        {status === "active" ? (
          <span className="px-0.5 text-[11px] font-medium text-gray-400">Active</span>
        ) : (
          <EngagementStatusBadge status={status} />
        )}
        <ChevronDown className="size-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-border bg-surface p-1 shadow-popover">
          {ENGAGEMENT_OPTIONS.map((o) => (
            <button
              key={o}
              onMouseDown={() => onChange(o)}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100"
            >
              {o === "active" ? <span className="text-gray-600">Active</span> : <EngagementStatusBadge status={o} />}
              <span className="sr-only">{ENGAGEMENT_LABELS[o]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusSelect({ status, onChange }: { status: LeadStatus; onChange: (s: LeadStatus) => void }) {
  const [open, setOpen] = useState(false);
  const options: LeadStatus[] = ["new", "qualified", "rejected"];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-gray-50"
      >
        <LeadStatusBadge status={status} />
        <ChevronDown className="size-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-32 rounded-lg border border-border bg-surface p-1 shadow-popover">
          {options.map((o) => (
            <button
              key={o}
              onMouseDown={() => onChange(o)}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs capitalize hover:bg-gray-100"
            >
              <LeadStatusBadge status={o} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
