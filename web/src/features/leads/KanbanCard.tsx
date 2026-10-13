import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { ResearchStatusBadge, DraftStatusBadge, SendStatusBadge, EngagementStatusBadge } from "./StatusBadges";
import { cn } from "../../lib/cn";
import type { EmailDraft, Lead, ResearchBrief } from "../../types";

interface Props {
  lead: Lead;
  brief?: ResearchBrief;
  draft?: EmailDraft;
  onOpenDetail: (lead: Lead) => void;
  isOverlay?: boolean;
}

export function KanbanCard({ lead, brief, draft, onOpenDetail, isOverlay }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => !isDragging && onOpenDetail(lead)}
      className={cn(
        "cursor-grab select-none space-y-2 rounded-lg border border-border-subtle bg-surface p-3 shadow-card active:cursor-grabbing",
        isDragging && !isOverlay && "opacity-30",
        isOverlay && "rotate-1 shadow-popover"
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={lead.fullName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
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
      {lead.company && <p className="truncate text-xs text-gray-400">{lead.company}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <ResearchStatusBadge status={brief?.status} />
        <DraftStatusBadge hasDraft={!!draft} />
        <SendStatusBadge status={draft?.sendStatus} />
        <EngagementStatusBadge status={lead.engagementStatus} />
      </div>
    </div>
  );
}
