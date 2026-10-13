import { useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import type { EmailDraft, Lead, LeadStatus, ResearchBrief } from "../../types";

const COLUMNS: { status: LeadStatus; label: string; accentClass: string }[] = [
  { status: "new", label: "New", accentClass: "bg-gray-400" },
  { status: "qualified", label: "Qualified", accentClass: "bg-emerald-500" },
  { status: "rejected", label: "Rejected", accentClass: "bg-red-400" },
];

interface Props {
  leads: Lead[];
  briefsByLead: Record<string, ResearchBrief>;
  draftsByLead: Record<string, EmailDraft>;
  onOpenDetail: (lead: Lead) => void;
  onStatusChange: (lead: Lead, status: LeadStatus) => void;
}

export function KanbanBoard({ leads, briefsByLead, draftsByLead, onOpenDetail, onStatusChange }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  const leadsByStatus = useMemo(() => {
    const grouped: Record<LeadStatus, Lead[]> = { new: [], qualified: [], rejected: [] };
    for (const lead of leads) grouped[lead.status].push(lead);
    return grouped;
  }, [leads]);

  const activeLead = activeId ? leads.find((l) => l.id === activeId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const overStatus = event.over?.id as LeadStatus | undefined;
    if (!overStatus) return;
    const lead = leads.find((l) => l.id === event.active.id);
    if (lead && lead.status !== overStatus) {
      onStatusChange(lead, overStatus);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex flex-1 gap-3 overflow-x-auto p-4">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            accentClass={col.accentClass}
            leads={leadsByStatus[col.status]}
            briefsByLead={briefsByLead}
            draftsByLead={draftsByLead}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
      <DragOverlay>
        {activeLead && (
          <KanbanCard
            lead={activeLead}
            brief={briefsByLead[activeLead.id]}
            draft={draftsByLead[activeLead.id]}
            onOpenDetail={() => undefined}
            isOverlay
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
