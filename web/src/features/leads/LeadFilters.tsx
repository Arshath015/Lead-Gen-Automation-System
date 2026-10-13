import { useState } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Popover, PopoverTrigger, PopoverContent } from "../../components/ui/Popover";
import { inputClass, labelClass, selectClass } from "../../components/ui/field";
import type { EmailDraft, EngagementStatus, IcpProfile, Lead, ResearchBrief } from "../../types";

export interface LeadFiltersState {
  icpProfileId: string;
  title: string;
  company: string;
  location: string;
  emailStatus: "" | "revealed" | "not_revealed";
  researchStatus: "" | "none" | "pending" | "in_progress" | "complete" | "failed";
  draftStatus: "" | "none" | "drafted";
  sendStatus: "" | "not_sent" | "sent" | "failed";
  engagementStatus: "" | EngagementStatus;
}

export const defaultLeadFilters: LeadFiltersState = {
  icpProfileId: "",
  title: "",
  company: "",
  location: "",
  emailStatus: "",
  researchStatus: "",
  draftStatus: "",
  sendStatus: "",
  engagementStatus: "",
};

export function countActiveFilters(filters: LeadFiltersState): number {
  return Object.values(filters).filter((v) => v !== "").length;
}

export function applyLeadFilters(
  leads: Lead[],
  filters: LeadFiltersState,
  briefsByLead: Record<string, ResearchBrief>,
  draftsByLead: Record<string, EmailDraft>
): Lead[] {
  return leads.filter((lead) => {
    if (filters.icpProfileId === "__none__" && lead.icpProfileId) return false;
    if (filters.icpProfileId && filters.icpProfileId !== "__none__" && lead.icpProfileId !== filters.icpProfileId) return false;
    if (filters.title && !(lead.title ?? "").toLowerCase().includes(filters.title.toLowerCase())) return false;
    if (filters.company && !(lead.company ?? "").toLowerCase().includes(filters.company.toLowerCase())) return false;
    if (filters.location && !(lead.location ?? "").toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.emailStatus === "revealed" && !lead.email) return false;
    if (filters.emailStatus === "not_revealed" && lead.email) return false;

    if (filters.researchStatus) {
      const status = briefsByLead[lead.id]?.status;
      if (filters.researchStatus === "none" ? !!status : status !== filters.researchStatus) return false;
    }

    if (filters.draftStatus) {
      const hasDraft = !!draftsByLead[lead.id];
      if (filters.draftStatus === "none" ? hasDraft : !hasDraft) return false;
    }

    if (filters.sendStatus) {
      const sendStatus = draftsByLead[lead.id]?.sendStatus ?? "not_sent";
      if (sendStatus !== filters.sendStatus) return false;
    }

    if (filters.engagementStatus && lead.engagementStatus !== filters.engagementStatus) return false;

    return true;
  });
}

interface Props {
  filters: LeadFiltersState;
  onChange: (filters: LeadFiltersState) => void;
  icpProfiles: IcpProfile[];
}

export function LeadFiltersPanel({ filters, onChange, icpProfiles }: Props) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(filters);

  function set<K extends keyof LeadFiltersState>(key: K, value: LeadFiltersState[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Filter className="size-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-accent-600 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="flex items-center justify-between pb-2">
          <p className="text-[13px] font-semibold text-ink">Filter leads</p>
          {activeCount > 0 && (
            <button
              onClick={() => onChange(defaultLeadFilters)}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-ink"
            >
              <X className="size-3" />
              Clear all
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelClass}>ICP profile</label>
            <select
              className={selectClass + " mt-1"}
              value={filters.icpProfileId}
              onChange={(e) => set("icpProfileId", e.target.value)}
            >
              <option value="">All profiles</option>
              {icpProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__none__">No profile (manual/other)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelClass}>Title contains</label>
              <input className={inputClass + " mt-1"} value={filters.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Company contains</label>
              <input className={inputClass + " mt-1"} value={filters.company} onChange={(e) => set("company", e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Location contains</label>
            <input className={inputClass + " mt-1"} value={filters.location} onChange={(e) => set("location", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelClass}>Email</label>
              <select
                className={selectClass + " mt-1"}
                value={filters.emailStatus}
                onChange={(e) => set("emailStatus", e.target.value as LeadFiltersState["emailStatus"])}
              >
                <option value="">Any</option>
                <option value="revealed">Revealed</option>
                <option value="not_revealed">Not revealed</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Research</label>
              <select
                className={selectClass + " mt-1"}
                value={filters.researchStatus}
                onChange={(e) => set("researchStatus", e.target.value as LeadFiltersState["researchStatus"])}
              >
                <option value="">Any</option>
                <option value="none">No research yet</option>
                <option value="complete">Complete</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
                <option value="in_progress">Running</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Draft</label>
              <select
                className={selectClass + " mt-1"}
                value={filters.draftStatus}
                onChange={(e) => set("draftStatus", e.target.value as LeadFiltersState["draftStatus"])}
              >
                <option value="">Any</option>
                <option value="drafted">Drafted</option>
                <option value="none">No draft yet</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Sent</label>
              <select
                className={selectClass + " mt-1"}
                value={filters.sendStatus}
                onChange={(e) => set("sendStatus", e.target.value as LeadFiltersState["sendStatus"])}
              >
                <option value="">Any</option>
                <option value="sent">Sent</option>
                <option value="failed">Send failed</option>
                <option value="not_sent">Not sent</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Engagement</label>
            <select
              className={selectClass + " mt-1"}
              value={filters.engagementStatus}
              onChange={(e) => set("engagementStatus", e.target.value as LeadFiltersState["engagementStatus"])}
            >
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="replied">Replied</option>
              <option value="bounced">Bounced</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="not_interested">Not interested</option>
            </select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
