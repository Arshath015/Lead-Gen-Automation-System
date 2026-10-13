import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Download, RefreshCcw, UserPlus, Building2 } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { inputClass } from "../../components/ui/field";
import { LeadsTable, type LeadSortKey, type SortDirection } from "./LeadsTable";
import { KanbanBoard } from "./KanbanBoard";
import { BulkActionBar, type BulkAction } from "./BulkActionBar";
import { FindLeadsModal } from "./FindLeadsModal";
import { AddLeadModal } from "./AddLeadModal";
import { LeadDetailSheet } from "./LeadDetailSheet";
import { LeadFiltersPanel, defaultLeadFilters, applyLeadFilters, type LeadFiltersState } from "./LeadFilters";
import { RevealResultsDialog } from "./RevealResultsDialog";
import { useLeadsData } from "./useLeadsData";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import type { EmailDraft, IcpProfile, Lead, LeadStatus, ResearchBrief, RevealResult } from "../../types";

type StatusFilter = LeadStatus | "";
type ViewMode = "list" | "kanban";

export function LeadsPage() {
  const toast = useToast();
  const {
    leads,
    total,
    totalPages,
    page,
    setPage,
    serverStatus,
    setServerFilter,
    statusCounts,
    briefsByLead,
    draftsByLead,
    emailFrom,
    loading,
    error,
    reload,
    setLeads,
    setBriefsByLead,
    setDraftsByLead,
  } = useLeadsData();

  const [view, setView] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<LeadSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  // The status tabs and search box are now server-side filters (see
  // useLeadsData) — `search` here is only the input's own instant display
  // value, debounced before it's actually sent as serverSearch, so typing
  // doesn't fire a network request on every keystroke.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setServerFilter({ search }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const [filters, setFilters] = useState<LeadFiltersState>(defaultLeadFilters);
  const [icpProfiles, setIcpProfiles] = useState<IcpProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);

  const [findLeadsOpen, setFindLeadsOpen] = useState(false);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "research" | "email">("overview");
  const [pendingDelete, setPendingDelete] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revealResults, setRevealResults] = useState<RevealResult[] | null>(null);
  const [sendingQualified, setSendingQualified] = useState(false);

  useEffect(() => {
    api.listIcpProfiles().then(setIcpProfiles).catch(() => undefined);
  }, []);

  const icpProfilesById = useMemo(() => Object.fromEntries(icpProfiles.map((p) => [p.id, p])), [icpProfiles]);

  // Status and free-text search are now applied server-side (see
  // useLeadsData/leads.routes.ts) — statusCounts reflects the TRUE totals
  // across the whole table, not just the current page, exactly like the old
  // client-computed `counts` did across the (previously fully-loaded)
  // dataset.
  //
  // The LeadFiltersPanel's more detailed filters (title/company/location/
  // emailStatus/researchStatus/draftStatus/sendStatus/engagementStatus) and
  // table sort still apply client-side here — but now only over the current
  // page's leads, not the full table. That's an intentional, narrower scope
  // for this pass: several of those filters (research/draft/send status)
  // need a join against collections this migration didn't move to SQLite,
  // so a full server-side implementation is follow-up work, not something
  // silently promised here.
  const filteredLeads = useMemo(() => {
    let result = applyLeadFilters(leads, filters, briefsByLead, draftsByLead);
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "createdAt") cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sortKey === "fullName") cmp = a.fullName.localeCompare(b.fullName);
      else if (sortKey === "company") cmp = (a.company ?? "").localeCompare(b.company ?? "");
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return result;
  }, [leads, filters, briefsByLead, draftsByLead, sortKey, sortDirection]);

  function handleSortChange(key: LeadSortKey) {
    if (key === sortKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "createdAt" ? "desc" : "asc");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filteredLeads.length ? new Set() : new Set(filteredLeads.map((l) => l.id))));
  }

  function openDetail(lead: Lead, tab: "overview" | "research" | "email" = "overview") {
    setDetailTab(tab);
    setDetailLead(lead);
  }

  function patchLead(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDetailLead((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  function removeLead(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDetailLead((prev) => (prev && prev.id === id ? null : prev));
  }

  function patchBrief(brief: ResearchBrief) {
    setBriefsByLead((prev) => ({ ...prev, [brief.leadId]: brief }));
  }

  function patchDraft(draft: EmailDraft) {
    setDraftsByLead((prev) => ({ ...prev, [draft.leadId]: draft }));
  }

  async function handleRevealOne(id: string) {
    setRowBusyId(id);
    try {
      const updated = await api.revealLead(id);
      patchLead(updated);
      toast.push({ variant: "success", title: "Email revealed" });
    } catch (e) {
      toast.push({ variant: "error", title: "Reveal failed", description: (e as Error).message });
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleRowAction(lead: Lead, action: "qualify" | "reject" | "research" | "draft" | "send") {
    setRowBusyId(lead.id);
    try {
      if (action === "qualify" || action === "reject") {
        const updated = await api.updateLead(lead.id, { status: action === "qualify" ? "qualified" : "rejected" });
        patchLead(updated);
      } else if (action === "research") {
        const brief = await api.generateResearchBrief(lead.id, !!briefsByLead[lead.id]);
        patchBrief(brief);
        toast.push({ variant: "success", title: "Research complete" });
      } else if (action === "draft") {
        if (briefsByLead[lead.id]?.status !== "complete") {
          toast.push({ variant: "error", title: "Run research first" });
          return;
        }
        const draft = await api.generateEmailDraft(lead.id, !!draftsByLead[lead.id]);
        patchDraft(draft);
        toast.push({ variant: "success", title: "Draft generated" });
      } else if (action === "send") {
        const existing = draftsByLead[lead.id];
        if (!existing) {
          toast.push({ variant: "error", title: "No draft to send" });
          return;
        }
        if (existing.sendStatus === "sent") {
          openDetail(lead, "email");
          return;
        }
        if (!lead.email) {
          toast.push({ variant: "error", title: "Reveal email first" });
          return;
        }
        const draft = await api.sendEmailDraft(lead.id, false);
        patchDraft(draft);
        toast.push({ variant: "success", title: `Email sent to ${lead.email}` });
      }
    } catch (e) {
      toast.push({ variant: "error", title: "Action failed", description: (e as Error).message });
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleBulkAction(action: BulkAction) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(action);
    try {
      if (action === "qualify" || action === "reject") {
        const { updated } = await api.bulkUpdateStatus(ids, action === "qualify" ? "qualified" : "rejected");
        await reload();
        toast.push({ variant: "success", title: `${updated} lead${updated === 1 ? "" : "s"} ${action === "qualify" ? "qualified" : "rejected"}` });
      } else if (action === "reveal") {
        const { results } = await api.revealBulk(ids);
        await reload();
        setRevealResults(results);
      } else if (action === "research") {
        const { results } = await api.generateResearchBulk(ids);
        await reload();
        const ok = results.filter((r) => r.brief).length;
        toast.push({ variant: ok === results.length ? "success" : "info", title: `${ok}/${results.length} research briefs generated` });
      } else if (action === "draft") {
        const { results } = await api.generateEmailDraftBulk(ids);
        await reload();
        const ok = results.filter((r) => r.draft).length;
        toast.push({ variant: ok === results.length ? "success" : "info", title: `${ok}/${results.length} drafts generated` });
      } else if (action === "send") {
        const { results } = await api.sendEmailDraftBulk(ids);
        await reload();
        const ok = results.filter((r) => r.draft?.sendStatus === "sent").length;
        toast.push({ variant: ok === results.length ? "success" : "info", title: `${ok}/${results.length} emails sent` });
      } else if (action === "export") {
        const blob = await api.exportCsv(ids);
        downloadBlob(blob, "leads.csv");
      }
      setSelected(new Set());
    } catch (e) {
      toast.push({ variant: "error", title: "Bulk action failed", description: (e as Error).message });
    } finally {
      setBulkBusy(null);
    }
  }

  // Still a single deliberate click, not an automatic trigger the moment a
  // lead becomes Qualified — just scoped to the whole Qualified cohort in
  // one go instead of opening each lead's detail panel individually. Leads
  // already pushed are silently skipped server-side (see leads.routes.ts).
  async function handleSendQualifiedToCrm() {
    setSendingQualified(true);
    try {
      const result = await api.sendQualifiedToCrm();
      await reload();
      if (result.failed > 0) {
        toast.push({
          variant: result.pushed > 0 ? "info" : "error",
          title: `Sent ${result.pushed} of ${result.totalQualified - result.alreadyInCrm} to CRM`,
          description: `${result.failed} failed: ${result.failures[0]?.error ?? ""}`,
        });
      } else if (result.pushed === 0) {
        toast.push({ variant: "info", title: "Nothing to send", description: "Every qualified lead is already in the CRM." });
      } else {
        toast.push({ variant: "success", title: `Sent ${result.pushed} qualified lead${result.pushed === 1 ? "" : "s"} to CRM` });
      }
    } catch (e) {
      toast.push({ variant: "error", title: "Send to CRM failed", description: (e as Error).message });
    } finally {
      setSendingQualified(false);
    }
  }

  async function handleExportAll() {
    const blob = await api.exportCsv(filteredLeads.map((l) => l.id));
    downloadBlob(blob, "leads.csv");
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteLead(pendingDelete.id);
      removeLead(pendingDelete.id);
      toast.push({ variant: "success", title: `${pendingDelete.fullName} deleted` });
      setPendingDelete(null);
    } catch (e) {
      toast.push({ variant: "error", title: "Delete failed", description: (e as Error).message });
    } finally {
      setDeleting(false);
    }
  }

  // Shared by both List view's per-row status dropdown and Kanban's
  // drag-and-drop — same three pipeline stages, same API call, same
  // optimistic-update-then-revert-on-failure behavior, so the two views can
  // never drift into separate status-update paths. Optimistic because the
  // UI should already look moved/changed the instant the user acts; if the
  // backend rejects it, snap back and surface why.
  async function handleStatusChange(lead: Lead, status: LeadStatus) {
    const previous = lead.status;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status } : l)));
    try {
      const updated = await api.updateLead(lead.id, { status });
      patchLead(updated);
    } catch (e) {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: previous } : l)));
      toast.push({ variant: "error", title: "Couldn't move lead", description: (e as Error).message });
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Leads"
        description={`${filteredLeads.length} of ${leads.length} on this page · ${total} total`}
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={reload} title="Refresh">
              <RefreshCcw className="size-3.5" />
            </Button>
            <Button variant="outline" onClick={handleExportAll} disabled={filteredLeads.length === 0}>
              <Download className="size-3.5" />
              Export
            </Button>
            {statusCounts.qualified > 0 && (
              <Button
                variant="outline"
                onClick={handleSendQualifiedToCrm}
                disabled={sendingQualified}
                title="Send every Qualified lead not already in the CRM"
              >
                <Building2 className="size-3.5" />
                {sendingQualified ? "Sending…" : `Send Qualified to CRM (${statusCounts.qualified})`}
              </Button>
            )}
            <Button variant="outline" onClick={() => setAddLeadOpen(true)}>
              <UserPlus className="size-3.5" />
              Add lead
            </Button>
            <Button variant="primary" onClick={() => setFindLeadsOpen(true)}>
              <Plus className="size-3.5" />
              Find leads
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-6 pb-3">
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={serverStatus as StatusFilter}
            onChange={(v) => setServerFilter({ status: v })}
            options={[
              { value: "", label: "All", count: statusCounts.all },
              { value: "new", label: "New", count: statusCounts.new },
              { value: "qualified", label: "Qualified", count: statusCounts.qualified },
              { value: "rejected", label: "Rejected", count: statusCounts.rejected },
            ]}
          />
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: "List" },
              { value: "kanban", label: "Kanban" },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
            <input
              className={inputClass + " w-64 pl-8"}
              placeholder="Search name, company, email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <LeadFiltersPanel filters={filters} onChange={setFilters} icpProfiles={icpProfiles} />
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 flex items-center justify-between rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
          <button onClick={reload} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      {view === "list" ? (
        <LeadsTable
          leads={filteredLeads}
          loading={loading}
          briefsByLead={briefsByLead}
          draftsByLead={draftsByLead}
          icpProfilesById={icpProfilesById}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onOpenDetail={(lead) => openDetail(lead)}
          onRevealOne={handleRevealOne}
          onRowAction={handleRowAction}
          onStatusChange={handleStatusChange}
          onDelete={setPendingDelete}
          rowBusyId={rowBusyId}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
        />
      ) : (
        <KanbanBoard
          leads={filteredLeads}
          briefsByLead={briefsByLead}
          draftsByLead={draftsByLead}
          onOpenDetail={(lead) => openDetail(lead)}
          onStatusChange={handleStatusChange}
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border-subtle px-6 py-3 text-[12.5px] text-gray-500">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <BulkActionBar
        count={selected.size}
        busyAction={bulkBusy}
        onAction={handleBulkAction}
        onClear={() => setSelected(new Set())}
      />

      <FindLeadsModal open={findLeadsOpen} onOpenChange={setFindLeadsOpen} onSearchComplete={reload} />

      <AddLeadModal
        open={addLeadOpen}
        onOpenChange={setAddLeadOpen}
        onCreated={() => reload()}
      />

      {detailLead && (
        <LeadDetailSheet
          key={detailLead.id + detailTab}
          lead={detailLead}
          initialTab={detailTab}
          emailFrom={emailFrom}
          icpProfiles={icpProfiles}
          onClose={() => setDetailLead(null)}
          onLeadChanged={patchLead}
          onDeleted={removeLead}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete this lead?"
        description={pendingDelete ? `${pendingDelete.fullName} and all of its research/draft/send history will be permanently removed. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />

      <RevealResultsDialog
        open={!!revealResults}
        onOpenChange={(o) => !o && setRevealResults(null)}
        results={revealResults ?? []}
      />
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
