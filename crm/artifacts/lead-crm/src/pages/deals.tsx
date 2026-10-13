import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDeals, useCreateDeal, useUpdateDeal, useUpdateDealStage, useDeleteDeal,
  useListAccounts, useListContacts, getListDealsQueryKey,
  type Deal, type DealInput,
} from "@workspace/api-client-react";
import { useListStages, useListUsers } from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permission";
import { useAuth } from "@workspace/replit-auth-web";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDroppable,
} from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUndoAction } from "@/hooks/use-undo-action";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { Plus, Search, MoreHorizontal, Loader2, LayoutList, LayoutGrid, Building2, Calendar, Handshake } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { useDraggable } from "@dnd-kit/core";

const EMPTY_FORM: DealInput = { name: "", value: "", currency: "INR", probability: 0, notes: "" };

function formatCurrency(value: string | null | number) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(n)) return String(value);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

/** Two-letter initials from a full name string */
function initials(name: string): string {
  return name.split(" ").map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

// ── Deal card content for DragOverlay ghost ───────────────────────────────────
function DealCardGhost({ deal }: { deal: Deal }) {
  return (
    <div className="bg-background rounded-xl shadow-2xl border border-primary/20 p-4 w-[290px] rotate-1 scale-105 space-y-2">
      <p className="font-semibold text-sm leading-snug">{deal.name}</p>
      {deal.value && <p className="text-xs font-semibold text-primary">{formatCurrency(deal.value)}</p>}
      {deal.accountName && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3 w-3 shrink-0" />{deal.accountName}
        </p>
      )}
    </div>
  );
}

// ── Kanban card (draggable) ───────────────────────────────────────────────────
function KanbanCard({ deal, isDraggingGlobal, onEdit, onDelete, canDelete = true }: {
  deal: Deal; isDraggingGlobal: boolean; onEdit: () => void; onDelete: () => void; canDelete?: boolean;
}) {
  const [, navigate] = useLocation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
    opacity: isDragging ? 0.2 : 1,
    transition: transform ? undefined : "opacity 150ms ease",
    cursor: isDragging ? "grabbing" : "grab",
    pointerEvents: isDraggingGlobal && !isDragging ? "none" : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="bg-background rounded-xl shadow-sm hover:shadow-md border border-border/60 hover:border-primary/30 transition-all select-none"
    >
      {/* Card body */}
      <div className="p-3.5 space-y-2.5">

        {/* Row 1: reference tag + kebab menu */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded select-none">
            #{String(deal.id).padStart(4, "0")}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                onPointerDown={e => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/deals/${deal.id}`)}>View</DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
              {canDelete && <DropdownMenuItem className="text-destructive" onClick={onDelete}>Delete</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Row 2: deal name */}
        <p className="font-semibold text-sm leading-snug text-foreground line-clamp-2">
          {deal.name}
        </p>

        {/* Row 3: account */}
        {deal.accountName && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{deal.accountName}</span>
          </p>
        )}

        {/* Divider */}
        <div className="border-t border-border/50" />

        {/* Row 4: value + date left | owner avatar right */}
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            {deal.value
              ? <p className="text-xs font-semibold text-primary">{formatCurrency(deal.value)}</p>
              : <p className="text-xs text-muted-foreground/50">No value</p>
            }
            {deal.closeDate && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Calendar className="h-2.5 w-2.5 shrink-0" />
                {format(parseISO(deal.closeDate), "MMM d, yy")}
              </p>
            )}
          </div>
          {deal.ownerName && (
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ring-1 ring-border"
              style={{ backgroundColor: "hsl(var(--primary)/0.12)", color: "hsl(var(--primary))" }}
              title={deal.ownerName}
            >
              {initials(deal.ownerName)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Kanban column (droppable) ─────────────────────────────────────────────────
function KanbanColumn({ stageId, stageName, stageColor, deals, isDraggingGlobal, onEdit, onDelete, canDelete }: {
  stageId: number; stageName: string; stageColor: string;
  deals: Deal[]; isDraggingGlobal: boolean;
  onEdit: (d: Deal) => void; onDelete: (id: number) => void;
  canDelete?: (id: number) => boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  const total = deals.reduce((sum, d) => sum + (d.value ? parseFloat(d.value) : 0), 0);

  return (
    // Fixed width, never shrinks — parent overflow-x-auto handles horizontal scroll
    <div className="flex flex-col w-[290px] shrink-0">

      {/* ── Colored header pill ── */}
      <div
        className="rounded-xl px-3.5 py-2.5 mb-1 flex items-center justify-between gap-2 shadow-sm"
        style={{ backgroundColor: stageColor }}
      >
        <span className="text-sm font-semibold text-white truncate leading-tight">
          {stageName}
        </span>
        <span
          className="text-[11px] font-bold shrink-0 px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: "rgba(0,0,0,0.18)", color: "#fff" }}
        >
          {deals.length}
        </span>
      </div>

      {/* ── Total value row — always present so all columns align ── */}
      <p className="text-xs text-muted-foreground font-medium px-1 mb-2.5 min-h-[1.125rem]">
        {total > 0 ? formatCurrency(total) : <>&nbsp;</>}
      </p>

      {/* ── Drop zone ── */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-2.5 flex-1 min-h-[160px] rounded-xl p-2 transition-colors duration-150"
        style={{
          background: isOver
            ? `${stageColor}14`
            : "hsl(var(--muted)/0.45)",
          boxShadow: isOver ? `inset 0 0 0 2px ${stageColor}55` : undefined,
        }}
      >
        {deals.map(deal => (
          <KanbanCard
            key={deal.id}
            deal={deal}
            isDraggingGlobal={isDraggingGlobal}
            onEdit={() => onEdit(deal)}
            onDelete={() => onDelete(deal.id)}
            canDelete={canDelete ? canDelete(deal.id) : true}
          />
        ))}
        {deals.length === 0 && (
          <div
            className={`flex items-center justify-center h-24 text-xs rounded-lg border-2 border-dashed transition-colors duration-150 ${
              isOver ? "text-primary" : "border-muted-foreground/20 text-muted-foreground"
            }`}
            style={isOver ? { borderColor: `${stageColor}66`, color: stageColor } : undefined}
          >
            {isOver ? "Drop here" : "No deals"}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Deals() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const stageFilter = new URLSearchParams(searchStr).get("stage") as "won" | "lost" | "active" | null;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { execute: executeUndo } = useUndoAction();
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const effectiveView: "list" | "kanban" = stageFilter ? "list" : view;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Deal | null>(null);
  const [form, setForm] = useState<DealInput>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(new Set());
  const [activeDrag, setActiveDrag] = useState<Deal | null>(null);
  const [optimisticMoves, setOptimisticMoves] = useState<Record<number, number | null>>({});

  const { user: authUser } = useAuth();
  const { has, isSuperAdmin } = usePermissions();
  const canAssignOwner = has("deals.edit") || isSuperAdmin;

  const canDeleteDeal = (deal: Deal): boolean => {
    if (!has("deals.delete")) return false;
    if (authUser?.role === "admin" || isSuperAdmin) return true;
    return Number((deal as any).createdById) === Number(authUser?.id);
  };

  const { data, isLoading } = useListDeals({ search: search || undefined, page, limit: 200 });
  const { data: stages } = useListStages({ type: "deal" });
  const { data: accounts } = useListAccounts({ limit: 100 });
  const { data: contacts } = useListContacts({ limit: 100 });
  const { data: users } = useListUsers();

  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();
  const updateDealStage = useUpdateDealStage();
  const deleteDeal = useDeleteDeal();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });

  const handleInlineStageChange = async (dealId: number, stageId: number) => {
    try {
      await updateDeal.mutateAsync({ id: dealId, data: { stageId } });
      invalidate();
    } catch {
      toast({ title: "Failed to update stage", variant: "destructive" });
    }
  };

  const handleInlineOwnerChange = async (dealId: number, ownerIdStr: string) => {
    try {
      const ownerId = ownerIdStr ? Number(ownerIdStr) : null;
      await updateDeal.mutateAsync({ id: dealId, data: { ownerId } } as any);
      invalidate();
    } catch {
      toast({ title: "Failed to update owner", variant: "destructive" });
    }
  };

  const [serverError, setServerError] = useState<string | null>(null);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormErrors({}); setServerError(null); setDialogOpen(true); };
  const openEdit = (d: Deal) => {
    setEditTarget(d);
    setFormErrors({});
    setServerError(null);
    setForm({
      name: d.name, value: d.value ?? "", currency: d.currency ?? "INR",
      stageId: d.stageId ?? undefined, closeDate: d.closeDate ? d.closeDate.split("T")[0] : "",
      probability: d.probability ?? 0, accountId: d.accountId ?? undefined, contactId: d.contactId ?? undefined,
      ownerId: d.ownerId ?? undefined, notes: d.notes ?? "",
    });
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.name?.trim()) errors.name = "Deal name is required";
    const prob = Number(form.probability);
    if (form.probability !== undefined && form.probability !== null && (isNaN(prob) || prob < 0 || prob > 100)) {
      errors.probability = "Must be between 0 and 100";
    }
    if (form.value && isNaN(parseFloat(String(form.value)))) errors.value = "Must be a valid number";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    setServerError(null);
    if (!validateForm()) return;
    try {
      const payload: any = { ...form };
      if (!payload.value) delete payload.value;
      if (!payload.stageId) delete payload.stageId;
      if (!payload.closeDate) delete payload.closeDate;
      if (!payload.accountId) delete payload.accountId;
      if (!payload.contactId) delete payload.contactId;
      if (!payload.ownerId) delete payload.ownerId;
      if (editTarget) {
        await updateDeal.mutateAsync({ id: editTarget.id, data: payload });
        toast({ title: "Deal updated" });
      } else {
        await createDeal.mutateAsync({ data: payload });
        toast({ title: "Deal created" });
      }
      setDialogOpen(false);
      invalidate();
    } catch (e: any) {
      setServerError(e.message ?? "An unexpected error occurred. Please try again.");
    }
  };

  const handleDeleteWithUndo = (id: number, name: string) => {
    executeUndo(
      `"${name}" deleted.`,
      async () => {
        await deleteDeal.mutateAsync({ id });
        setPendingDeleteIds(s => { const n = new Set(s); n.delete(id); return n; });
        invalidate();
      },
      () => setPendingDeleteIds(s => new Set([...s, id])),
      () => setPendingDeleteIds(s => { const n = new Set(s); n.delete(id); return n; }),
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    const deal = allDeals.find(d => d.id === event.active.id);
    setActiveDrag(deal ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const deal = allDeals.find(d => d.id === active.id);
    if (!deal) return;
    const newStageId = Number(over.id);
    const currentStageId = deal.id in optimisticMoves ? optimisticMoves[deal.id] : deal.stageId;
    if (currentStageId === newStageId) return;

    setOptimisticMoves(prev => ({ ...prev, [deal.id]: newStageId }));

    try {
      await updateDealStage.mutateAsync({ id: deal.id, data: { stageId: newStageId as number } });
      await invalidate();
      setOptimisticMoves(prev => { const n = { ...prev }; delete n[deal.id]; return n; });
    } catch {
      setOptimisticMoves(prev => { const n = { ...prev }; delete n[deal.id]; return n; });
      toast({ title: "Failed to move deal", variant: "destructive" });
    }
  };

  const allDeals = (data?.deals ?? []).filter(d => !pendingDeleteIds.has(d.id));
  const wonStageIds = stages?.filter(s => s.isWon).map(s => s.id) ?? [];
  const lostStageIds = stages?.filter(s => s.isLost).map(s => s.id) ?? [];
  const activeStageIds = stages?.filter(s => !s.isWon && !s.isLost).map(s => s.id) ?? [];
  const deals = stageFilter === "won"
    ? allDeals.filter(d => d.stageId != null && wonStageIds.includes(d.stageId))
    : stageFilter === "lost"
    ? allDeals.filter(d => d.stageId != null && lostStageIds.includes(d.stageId))
    : stageFilter === "active"
    ? allDeals.filter(d => d.stageId != null && activeStageIds.includes(d.stageId))
    : allDeals;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
          <p className="text-muted-foreground">Track opportunities and pipeline value.</p>
        </div>
        <div className="flex items-center gap-2">
          {!stageFilter && (
            <Tabs value={view} onValueChange={v => setView(v as "list" | "kanban")}>
              <TabsList>
                <TabsTrigger value="kanban"><LayoutGrid className="h-4 w-4 mr-1.5" />Kanban</TabsTrigger>
                <TabsTrigger value="list"><LayoutList className="h-4 w-4 mr-1.5" />List</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Button variant="cta" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New Deal</Button>
        </div>
      </div>

      {/* Active stage filter chip */}
      {stageFilter && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {stageFilter === "won" ? "✓ Closed deals" : stageFilter === "lost" ? "✗ Dropped deals" : "⟳ Ongoing deals"}
          </Badge>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => navigate("/deals")}>
            Clear filter ×
          </Button>
        </div>
      )}

      {/* Search bar */}
      <div className="relative max-w-[320px]">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search deals..." className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {isLoading ? (
        // ── Skeleton ──────────────────────────────────────────────────────────
        effectiveView === "kanban" ? (
          <div className="flex gap-4 overflow-x-auto pb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col w-[290px] shrink-0 gap-3">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-3 w-20" />
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="bg-background rounded-xl border p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-10" />
                    </div>
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-24" />
                    <div className="border-t pt-2 flex items-center justify-between">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead><TableHead>Value</TableHead><TableHead>Stage</TableHead>
                      <TableHead>Account</TableHead><TableHead>Owner</TableHead><TableHead>Close Date</TableHead>
                      <TableHead>Prob.</TableHead><TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )
      ) : deals.length === 0 ? (
        // ── Empty state ───────────────────────────────────────────────────────
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Handshake className="h-5 w-5" /></EmptyMedia>
            <EmptyTitle>No deals yet</EmptyTitle>
            <EmptyDescription>
              {search ? `No deals match "${search}".` : "Create your first deal to start tracking pipeline value."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {!search && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />New Deal
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : effectiveView === "kanban" ? (
        // ── Kanban View ───────────────────────────────────────────────────────
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-6 -mx-1 px-1">
            {stages?.map(stage => {
              const stageDeals = deals.filter(d => {
                const effective = d.id in optimisticMoves ? optimisticMoves[d.id] : d.stageId;
                return effective === stage.id;
              });
              return (
                <KanbanColumn
                  key={stage.id}
                  stageId={stage.id}
                  stageName={stage.name}
                  stageColor={stage.color}
                  deals={stageDeals}
                  isDraggingGlobal={!!activeDrag}
                  onEdit={openEdit}
                  onDelete={id => {
                    const deal = allDeals.find(d => d.id === id);
                    handleDeleteWithUndo(id, deal?.name ?? "Deal");
                  }}
                  canDelete={id => {
                    const deal = allDeals.find(d => d.id === id);
                    return deal ? canDeleteDeal(deal) : false;
                  }}
                />
              );
            })}
          </div>
          {/* DragOverlay: floating ghost that follows the pointer */}
          <DragOverlay dropAnimation={{ duration: 180, easing: "ease" }}>
            {activeDrag ? <DealCardGhost deal={activeDrag} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        // ── List View ─────────────────────────────────────────────────────────
        <Card>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Close Date</TableHead>
                    <TableHead>Prob.</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map(d => (
                    <TableRow key={d.id} className="group">
                      <TableCell className="font-semibold">{d.name}</TableCell>
                      <TableCell className="font-medium text-primary">{d.value ? formatCurrency(d.value) : "—"}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <select
                          value={d.stageId?.toString() ?? ""}
                          onChange={e => handleInlineStageChange(d.id, Number(e.target.value))}
                          className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring max-w-[130px]"
                          style={{ color: d.stageColor || undefined }}
                        >
                          {stages?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.accountName ?? "—"}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        {canAssignOwner ? (
                          <select
                            value={d.ownerId ? String(d.ownerId) : ""}
                            onChange={e => handleInlineOwnerChange(d.id, e.target.value)}
                            className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring max-w-[150px]"
                          >
                            <option value="">Unassigned</option>
                            {users?.map((u: any) => (
                              <option key={u.id} value={String(u.id)}>
                                {u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.username}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm text-muted-foreground">{d.ownerName ?? "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.closeDate ? format(parseISO(d.closeDate), "MMM d, yyyy") : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.probability != null ? `${d.probability}%` : "—"}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8" aria-label={`Actions for ${d.name}`}>
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/deals/${d.id}`)}>View</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(d)}>Edit</DropdownMenuItem>
                            {canDeleteDeal(d) && <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteWithUndo(d.id, d.name)}>Delete</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden divide-y">
              {deals.map(d => (
                <div key={d.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button className="font-semibold text-sm text-left hover:text-primary transition-colors" onClick={() => navigate(`/deals/${d.id}`)}>
                        {d.name}
                      </button>
                      {d.value && <p className="text-sm font-medium text-primary mt-0.5">{formatCurrency(d.value)}</p>}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {d.stageName && (
                          <Badge variant="outline" className="text-[10px] py-0" style={{ backgroundColor: `${d.stageColor}15`, color: d.stageColor || "inherit", borderColor: `${d.stageColor}30` }}>
                            {d.stageName}
                          </Badge>
                        )}
                        {d.accountName && <span className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" aria-hidden="true" />{d.accountName}</span>}
                        {d.ownerName && <span className="text-xs text-muted-foreground">{d.ownerName}</span>}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${d.name}`}>
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/deals/${d.id}`)}>View</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(d)}>Edit</DropdownMenuItem>
                        {canDeleteDeal(d) && <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteWithUndo(d.id, d.name)}>Delete</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Deal" : "New Deal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="dealName">Deal Name <span className="text-destructive">*</span></Label>
              <Input
                id="dealName"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Acme Corp — Enterprise Tier"
                aria-invalid={!!formErrors.name}
                className={formErrors.name ? "border-destructive" : ""}
              />
              {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="dealValue">Value</Label>
                <Input
                  id="dealValue"
                  value={form.value ?? ""}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="50000"
                  type="number"
                  aria-invalid={!!formErrors.value}
                  className={formErrors.value ? "border-destructive" : ""}
                />
                {formErrors.value && <p className="text-xs text-destructive">{formErrors.value}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="dealProbability">Probability (%)</Label>
                <Input
                  id="dealProbability"
                  value={form.probability ?? ""}
                  onChange={e => setForm(f => ({ ...f, probability: Number(e.target.value) }))}
                  type="number"
                  min={0}
                  max={100}
                  aria-invalid={!!formErrors.probability}
                  className={formErrors.probability ? "border-destructive" : ""}
                />
                {formErrors.probability && <p className="text-xs text-destructive">{formErrors.probability}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Stage</Label>
                <Select value={form.stageId?.toString() ?? "none"} onValueChange={v => setForm(f => ({ ...f, stageId: v === "none" ? undefined : Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Select stage..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No stage</SelectItem>
                    {stages?.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Close Date</Label>
                <Input type="date" value={form.closeDate ?? ""} onChange={e => setForm(f => ({ ...f, closeDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Account</Label>
              <Select value={form.accountId?.toString() ?? "none"} onValueChange={v => setForm(f => ({ ...f, accountId: v === "none" ? undefined : Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No account</SelectItem>
                  {accounts?.accounts.map(a => <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Contact</Label>
              <Select value={form.contactId?.toString() ?? "none"} onValueChange={v => setForm(f => ({ ...f, contactId: v === "none" ? undefined : Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Select contact..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No contact</SelectItem>
                  {contacts?.contacts.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.firstName} {c.lastName ?? ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Owner</Label>
              <Select value={form.ownerId?.toString() ?? "none"} onValueChange={v => setForm(f => ({ ...f, ownerId: v === "none" ? undefined : Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Assign owner..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.username}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>
          </div>
          {serverError && (
            <p className="text-sm text-destructive px-1 -mb-2" role="alert">{serverError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleSave} disabled={createDeal.isPending || updateDeal.isPending}>
              {(createDeal.isPending || updateDeal.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {editTarget ? "Save Changes" : "Create Deal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
