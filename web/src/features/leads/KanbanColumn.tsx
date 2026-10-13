import { useDroppable } from "@dnd-kit/core";
import { cn } from "../../lib/cn";
import { KanbanCard } from "./KanbanCard";
import type { EmailDraft, Lead, LeadStatus, ResearchBrief } from "../../types";

interface Props {
  status: LeadStatus;
  label: string;
  accentClass: string;
  leads: Lead[];
  briefsByLead: Record<string, ResearchBrief>;
  draftsByLead: Record<string, EmailDraft>;
  onOpenDetail: (lead: Lead) => void;
}

export function KanbanColumn({ status, label, accentClass, leads, briefsByLead, draftsByLead, onOpenDetail }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex w-80 shrink-0 flex-col rounded-xl bg-gray-50">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn("size-2 rounded-full", accentClass)} />
        <p className="text-[13px] font-semibold text-ink">{label}</p>
        <span className="ml-auto rounded-full bg-gray-200 px-1.5 text-[11px] font-medium text-gray-500">
          {leads.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-2 overflow-y-auto rounded-b-xl p-2.5 pt-0 transition-colors",
          isOver && "bg-accent-50/60 ring-2 ring-inset ring-accent-300"
        )}
      >
        {leads.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">
            No leads here
          </div>
        )}
        {leads.map((lead) => (
          <KanbanCard
            key={lead.id}
            lead={lead}
            brief={briefsByLead[lead.id]}
            draft={draftsByLead[lead.id]}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
    </div>
  );
}
