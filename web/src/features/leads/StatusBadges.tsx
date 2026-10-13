import { CircleDashed, CircleCheck, CircleX, Loader2, Minus, MailX, Ban, ThumbsDown, ChevronDown, Check } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../../components/ui/DropdownMenu";
import type { EngagementStatus, LeadStatus, ResearchStatus, SendStatus } from "../../types";

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  if (status === "qualified") return <Badge tone="green">Qualified</Badge>;
  if (status === "rejected") return <Badge tone="red">Rejected</Badge>;
  return <Badge tone="gray">New</Badge>;
}

const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "qualified", label: "Qualified" },
  { value: "rejected", label: "Rejected" },
];

// Compact, click-to-change version of LeadStatusBadge for List view rows —
// same three pipeline stages Kanban's columns represent, so a caller just
// wires this to the exact same status-change handler Kanban's drag-and-drop
// already uses (see LeadsPage.tsx's handleStatusChange) rather than a
// second, parallel status-update path.
export function LeadStatusDropdown({ status, onChange }: { status: LeadStatus; onChange: (status: LeadStatus) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group/status inline-flex items-center gap-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-300"
          title="Change status"
        >
          <LeadStatusBadge status={status} />
          <ChevronDown className="size-3 text-gray-400 opacity-0 transition-opacity group-hover/status:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        {LEAD_STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt.value} onSelect={() => opt.value !== status && onChange(opt.value)}>
            <span className="flex w-full items-center justify-between">
              {opt.label}
              {opt.value === status && <Check className="size-3.5 text-accent-600" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EngagementStatusBadge({ status }: { status: EngagementStatus }) {
  if (status === "replied") return <Badge tone="blue" icon={<CircleCheck className="size-3" />}>Replied</Badge>;
  if (status === "bounced") return <Badge tone="red" icon={<MailX className="size-3" />}>Bounced</Badge>;
  if (status === "unsubscribed") return <Badge tone="red" icon={<Ban className="size-3" />}>Unsubscribed</Badge>;
  if (status === "not_interested") return <Badge tone="amber" icon={<ThumbsDown className="size-3" />}>Not interested</Badge>;
  return null;
}

export function ResearchStatusBadge({ status }: { status: ResearchStatus | undefined }) {
  if (!status) return <span className="text-xs text-gray-300">—</span>;
  if (status === "complete") return <Badge tone="green" icon={<CircleCheck className="size-3" />}>Complete</Badge>;
  if (status === "failed") return <Badge tone="red" icon={<CircleX className="size-3" />}>Failed</Badge>;
  if (status === "in_progress") return <Badge tone="blue" icon={<Loader2 className="size-3 animate-spin" />}>Running</Badge>;
  return <Badge tone="amber" icon={<CircleDashed className="size-3" />}>Pending</Badge>;
}

export function DraftStatusBadge({ hasDraft }: { hasDraft: boolean }) {
  if (hasDraft) return <Badge tone="violet">Drafted</Badge>;
  return <span className="text-xs text-gray-300">—</span>;
}

export function SendStatusBadge({ status }: { status: SendStatus | undefined }) {
  if (!status || status === "not_sent") return <span className="text-xs text-gray-300">—</span>;
  if (status === "sent") return <Badge tone="green" icon={<CircleCheck className="size-3" />}>Sent</Badge>;
  if (status === "sending") return <Badge tone="blue" icon={<Loader2 className="size-3 animate-spin" />}>Sending</Badge>;
  return <Badge tone="red" icon={<CircleX className="size-3" />}>Failed</Badge>;
}

export function EmptyDash() {
  return <Minus className="size-3 text-gray-300" />;
}
