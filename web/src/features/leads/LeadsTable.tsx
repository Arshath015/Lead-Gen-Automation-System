import { MoreHorizontal, KeyRound, Sparkles, PenLine, Send, CheckCircle2, XCircle, ExternalLink, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import { LeadStatusDropdown, EngagementStatusBadge, ResearchStatusBadge, DraftStatusBadge, SendStatusBadge } from "./StatusBadges";
import { formatRelativeTime, formatAbsoluteDateTime } from "../../lib/format";
import type { EmailDraft, IcpProfile, Lead, LeadStatus, ResearchBrief } from "../../types";

export type LeadSortKey = "fullName" | "company" | "createdAt";
export type SortDirection = "asc" | "desc";

interface Props {
  leads: Lead[];
  loading: boolean;
  briefsByLead: Record<string, ResearchBrief>;
  draftsByLead: Record<string, EmailDraft>;
  icpProfilesById: Record<string, IcpProfile>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpenDetail: (lead: Lead) => void;
  onRevealOne: (id: string) => void;
  onRowAction: (lead: Lead, action: "qualify" | "reject" | "research" | "draft" | "send") => void;
  onStatusChange: (lead: Lead, status: LeadStatus) => void;
  onDelete: (lead: Lead) => void;
  rowBusyId: string | null;
  sortKey: LeadSortKey;
  sortDirection: SortDirection;
  onSortChange: (key: LeadSortKey) => void;
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSortChange,
}: {
  label: string;
  sortKey: LeadSortKey;
  activeKey: LeadSortKey;
  direction: SortDirection;
  onSortChange: (key: LeadSortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th className="px-2 py-2 font-medium">
      <button onClick={() => onSortChange(sortKey)} className="flex items-center gap-1 hover:text-gray-600">
        {label}
        {active &&
          (direction === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}

export function LeadsTable({
  leads,
  loading,
  briefsByLead,
  draftsByLead,
  icpProfilesById,
  selected,
  onToggle,
  onToggleAll,
  onOpenDetail,
  onRevealOne,
  onRowAction,
  onStatusChange,
  onDelete,
  rowBusyId,
  sortKey,
  sortDirection,
  onSortChange,
}: Props) {
  if (loading) {
    return (
      <div className="flex-1 overflow-hidden">
        <div className="divide-y divide-border-subtle">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="size-4" />
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="ml-auto h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-[14px] font-medium text-ink">No leads yet</p>
        <p className="max-w-xs text-[13px] text-gray-500">
          Use "Find leads" above to pull matching contacts from Apollo for an ICP profile.
        </p>
      </div>
    );
  }

  const allSelected = leads.length > 0 && selected.size === leads.length;

  return (
    <div className="flex-1 overflow-auto">
      {/* min-w forces a horizontal scrollbar on the container above instead
          of squeezing every column illegibly thin on laptop/tablet widths. */}
      <table className="w-full min-w-[1080px] border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border-subtle text-[11px] font-medium uppercase tracking-wide text-gray-400">
            <th className="w-10 px-4 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                className="size-3.5 rounded border-gray-300 accent-accent-600"
              />
            </th>
            <SortableHeader label="Lead" sortKey="fullName" activeKey={sortKey} direction={sortDirection} onSortChange={onSortChange} />
            <SortableHeader label="Company" sortKey="company" activeKey={sortKey} direction={sortDirection} onSortChange={onSortChange} />
            <th className="px-2 py-2 font-medium">ICP</th>
            <th className="px-2 py-2 font-medium">Email</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Research</th>
            <th className="px-2 py-2 font-medium">Draft</th>
            <th className="px-2 py-2 font-medium">Sent</th>
            <SortableHeader label="Created" sortKey="createdAt" activeKey={sortKey} direction={sortDirection} onSortChange={onSortChange} />
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const brief = briefsByLead[lead.id];
            const draft = draftsByLead[lead.id];
            const isSelected = selected.has(lead.id);
            const isBusy = rowBusyId === lead.id;

            return (
              <tr
                key={lead.id}
                className={
                  "group cursor-pointer border-b border-border-subtle transition-colors " +
                  (isSelected ? "bg-accent-50/40" : "hover:bg-gray-50")
                }
                onClick={() => onOpenDetail(lead)}
              >
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(lead.id)}
                    className="size-3.5 rounded border-gray-300 accent-accent-600"
                  />
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={lead.fullName} size="sm" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                        {lead.fullName}
                        {lead.source !== "apollo" && (
                          <Badge tone="violet" className="shrink-0">
                            Manual
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-gray-500">{lead.title ?? "—"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-gray-600">
                  <span className="truncate">{lead.company ?? "—"}</span>
                </td>
                <td className="px-2 py-2.5 text-gray-500">
                  <span className="truncate">{lead.icpProfileId ? icpProfilesById[lead.icpProfileId]?.name ?? "—" : "—"}</span>
                </td>
                <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {lead.email ? (
                    <span className="text-gray-600">{lead.email}</span>
                  ) : (
                    <button
                      onClick={() => onRevealOne(lead.id)}
                      disabled={isBusy}
                      title="Spends 1 Apollo lead credit"
                      className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-40"
                    >
                      <KeyRound className="size-3" />
                      Reveal
                    </button>
                  )}
                </td>
                <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center gap-1">
                    <LeadStatusDropdown status={lead.status} onChange={(status) => onStatusChange(lead, status)} />
                    <EngagementStatusBadge status={lead.engagementStatus} />
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <ResearchStatusBadge status={brief?.status} />
                </td>
                <td className="px-2 py-2.5">
                  <DraftStatusBadge hasDraft={!!draft} />
                </td>
                <td className="px-2 py-2.5">
                  <SendStatusBadge status={draft?.sendStatus} />
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-gray-500" title={formatAbsoluteDateTime(lead.createdAt)}>
                  {formatRelativeTime(lead.createdAt)}
                </td>
                <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="rounded-md p-1 text-gray-400 opacity-0 hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-gray-100">
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => onOpenDetail(lead)} icon={<ExternalLink className="size-3.5" />}>
                        Open details
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onRowAction(lead, "research")} icon={<Sparkles className="size-3.5" />}>
                        {brief ? "Regenerate research" : "Run research"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onRowAction(lead, "draft")}
                        disabled={brief?.status !== "complete"}
                        icon={<PenLine className="size-3.5" />}
                      >
                        {draft ? "Regenerate draft" : "Generate draft"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onRowAction(lead, "send")}
                        disabled={!draft || !lead.email}
                        icon={<Send className="size-3.5" />}
                      >
                        {draft?.sendStatus === "sent" ? "Resend" : "Send email"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onRowAction(lead, "qualify")} icon={<CheckCircle2 className="size-3.5" />}>
                        Mark qualified
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onRowAction(lead, "reject")}
                        destructive
                        icon={<XCircle className="size-3.5" />}
                      >
                        Reject
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onDelete(lead)} destructive icon={<Trash2 className="size-3.5" />}>
                        Delete lead
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
