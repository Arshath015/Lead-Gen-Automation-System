import { useEffect, useState } from "react";
import { useListLeads, useListStages, useListUsers, useBulkLeadAction, useImportLeads, useCreateLead, useListTags, useUpdateLeadStage, useUpdateLead, useDeleteLead } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { usePermissions } from "@/hooks/use-permission";
import { Link, useSearch } from "wouter";
import { getLeadListUrlFilters } from "@/lib/lead-list-filters";
import { LEAD_CHANNEL_LABELS as CHANNEL_LABELS } from "@/lib/lead-channels";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Upload, Loader2, SlidersHorizontal, X, Download, Users, ExternalLink, FileSpreadsheet } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { IndustrySelect } from "@/components/industry-select";
import { IndustryFilter } from "@/components/industry-filter";
import { decodeIndustrySelection } from "@/lib/industry-filter-selection";
import { useToast } from "@/hooks/use-toast";
import { useUndoAction } from "@/hooks/use-undo-action";
import Papa from "papaparse";
import { PriorityBadge, PrioritySelect } from "@/components/priority-badge";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";

export default function Leads() {
  const { user: authUser } = useAuth();
  // Read URL search params to support drill-down from dashboard charts
  const searchStr = useSearch();
  const urlFilters = getLeadListUrlFilters(searchStr);

  const [search, setSearch] = useState(urlFilters.search);
  const [stageId, setStageId] = useState<string>(urlFilters.stageId);
  const [priority, setPriority] = useState<string>(urlFilters.priority);
  const [channel, setChannel] = useState<string>(urlFilters.channel);
  const [tagId, setTagId] = useState<string>(urlFilters.tagId);
  const [ownerFilter, setOwnerFilter] = useState<string>(urlFilters.ownerFilter);
  const [locationFilter, setLocationFilter] = useState<string>(urlFilters.location);
  const [industryFilter, setIndustryFilter] = useState<string>(urlFilters.industry);
  const [sourceFilter, setSourceFilter] = useState<string>(urlFilters.source);
  const [dateFrom, setDateFrom] = useState<string>(urlFilters.dateFrom);
  const [dateTo, setDateTo] = useState<string>(urlFilters.dateTo);
  const [statusFilter, setStatusFilter] = useState<string>(urlFilters.status);
  const [unassignedFilter, setUnassignedFilter] = useState<boolean>(urlFilters.unassigned);
  const [missingFilter, setMissingFilter] = useState<string>(urlFilters.missing);
  const [staleFilter, setStaleFilter] = useState<boolean>(urlFilters.stale);
  const [followupDue, setFollowupDue] = useState<string>(urlFilters.followupDue);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(new Set());
  const { execute: executeUndo } = useUndoAction();

  // Wouter keeps the Leads component mounted when only the query string changes.
  // Without this sync, a dashboard owner filter can survive navigation back to
  // /leads and incorrectly hide the authenticated assignee's leads.
  useEffect(() => {
    const next = getLeadListUrlFilters(searchStr);
    setSearch(next.search);
    setStageId(next.stageId);
    setPriority(next.priority);
    setChannel(next.channel);
    setTagId(next.tagId);
    setOwnerFilter(next.ownerFilter);
    setLocationFilter(next.location);
    setIndustryFilter(next.industry);
    setSourceFilter(next.source);
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
    setStatusFilter(next.status);
    setUnassignedFilter(next.unassigned);
    setMissingFilter(next.missing);
    setStaleFilter(next.stale);
    setFollowupDue(next.followupDue);
    setPage(1);
    setSelectedIds([]);
  }, [searchStr]);
  
  const { data: leadsData, isLoading: loadingLeads, refetch } = useListLeads({
    page,
    limit: 20,
    search: search || undefined,
    stageId: stageId !== "all" ? Number(stageId) : undefined,
    priority: priority !== "all" ? (priority as any) : undefined,
    channel: channel !== "all" ? (channel as any) : undefined,
    tagId: tagId !== "all" ? Number(tagId) : undefined,
    ownerId: (ownerFilter !== "all" && ownerFilter !== "unassigned") ? Number(ownerFilter) : undefined,
    location: locationFilter || undefined,
    industry: industryFilter || undefined,
    source: sourceFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    unassigned: (ownerFilter === "unassigned" || unassignedFilter) ? "true" : undefined,
    missing: missingFilter || undefined,
    stale: staleFilter ? "true" : undefined,
    followupDue: followupDue || undefined,
  } as any);
  
  const { data: stages } = useListStages({ type: "lead" });
  const { data: users } = useListUsers();
  const { data: tags } = useListTags();
  
  const bulkAction = useBulkLeadAction();
  const importLeads = useImportLeads();
  const createLead = useCreateLead();
  const updateLeadStage = useUpdateLeadStage();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const { toast } = useToast();
  const { has } = usePermissions();
  const canAssignOwner = has("leads.assign") || authUser?.role === "admin" || authUser?.role === "manager" || (authUser as any)?.isSuperAdmin;

  const handleInlineStageChange = async (leadId: number, stageId: number) => {
    try {
      await updateLeadStage.mutateAsync({ id: leadId, data: { stageId } });
      refetch();
    } catch {
      toast({ title: "Failed to update stage", variant: "destructive" });
    }
  };

  const handleInlineFieldChange = async (leadId: number, field: string, value: string | null) => {
    try {
      await updateLead.mutateAsync({ id: leadId, data: { [field]: value } } as any);
      refetch();
    } catch {
      toast({ title: "Failed to update field", variant: "destructive" });
    }
  };

  const handleInlineOwnerChange = async (leadId: number, ownerIdStr: string) => {
    try {
      const ownerId = ownerIdStr ? Number(ownerIdStr) : null;
      await updateLead.mutateAsync({ id: leadId, data: { ownerId } } as any);
      refetch();
    } catch {
      toast({ title: "Failed to update owner", variant: "destructive" });
    }
  };

  // Auto-open the filter panel on load when any panel-specific URL param is active
  // (priority, channel, ownerId, location, industry, dateFrom, dateTo).
  // This way the user can immediately see and adjust filters set by a dashboard click.
  const [filterOpen, setFilterOpen] = useState(() => new URLSearchParams(searchStr).size > 0);

  useEffect(() => {
    setFilterOpen(new URLSearchParams(searchStr).size > 0);
  }, [searchStr]);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<"upload" | "preview" | "importing">("upload");
  const [importParsedRows, setImportParsedRows] = useState<any[]>([]);
  const [importValidation, setImportValidation] = useState<{ valid: number; failed: number; errors: { row: number; message: string }[] } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    companyName: "",
    contactPerson: "",
    email: "",
    phone: "",
    location: "",
    designation: "",
    industry: "",
    linkedinUrl: "",
    websiteUrl: "",
    remarks: "",
    comment: "",
    priority: null as string | null,
    channel: null as string | null,
    valueAmount: "" as string,
    expectedCloseDate: "" as string,
  });
  const [createFormErrors, setCreateFormErrors] = useState<Record<string, string>>({});
  const [createServerError, setCreateServerError] = useState<string | null>(null);

  const validateCreateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.companyName.trim()) errors.companyName = "Company name is required";
    if (!formData.contactPerson.trim()) errors.contactPerson = "Contact person is required";
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = "Invalid email format";
    if (formData.websiteUrl && !/^https?:\/\/.+/.test(formData.websiteUrl)) errors.websiteUrl = "URL must start with http:// or https://";
    if (formData.linkedinUrl && !/^https?:\/\/.+/.test(formData.linkedinUrl)) errors.linkedinUrl = "URL must start with http:// or https://";
    setCreateFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateLead = async () => {
    setCreateServerError(null);
    if (!validateCreateForm()) return;
    try {
      const payload: any = {
        companyName: formData.companyName,
        contactPerson: formData.contactPerson,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
      };
      if (formData.priority) payload.priority = formData.priority;
      if (formData.channel) payload.channel = formData.channel;
      if (formData.location) payload.location = formData.location;
      if (formData.designation) payload.designation = formData.designation;
      if (formData.industry) payload.industry = formData.industry;
      if (formData.linkedinUrl) payload.linkedinUrl = formData.linkedinUrl;
      if (formData.websiteUrl) payload.websiteUrl = formData.websiteUrl;
      if (formData.remarks) payload.remarks = formData.remarks;
      if (formData.comment) payload.comment = formData.comment;
      if (formData.valueAmount) payload.valueAmount = formData.valueAmount;
      if (formData.expectedCloseDate) payload.expectedCloseDate = formData.expectedCloseDate;
      await createLead.mutateAsync({ data: payload });
      toast({ title: "Lead created" });
      setCreateOpen(false);
      setCreateFormErrors({});
      setFormData({ companyName: "", contactPerson: "", email: "", phone: "", location: "", designation: "", industry: "", linkedinUrl: "", websiteUrl: "", remarks: "", comment: "", priority: null, channel: null, valueAmount: "", expectedCloseDate: "" });
      refetch();
    } catch (e: any) {
      setCreateServerError(e.message ?? "An unexpected error occurred. Please try again.");
    }
  };

  const visibleLeads = (leadsData?.leads ?? []).filter(l => !pendingDeleteIds.has(l.id));

  const toggleAll = (checked: boolean) => {
    if (checked) setSelectedIds(visibleLeads.map(l => l.id));
    else setSelectedIds([]);
  };

  const toggleOne = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(i => i !== id));
    }
  };

  // Per-row delete: row hides instantly, API call fires immediately (no undo delay)
  const handleDeleteLeadRow = async (id: number, name: string) => {
    setPendingDeleteIds(s => new Set([...s, id]));
    setSelectedIds(prev => prev.filter(i => i !== id));
    try {
      await deleteLead.mutateAsync({ id });
      refetch();
    } catch {
      setPendingDeleteIds(s => { const n = new Set(s); n.delete(id); return n; });
      toast({ title: `Failed to delete "${name}"`, variant: "destructive" });
    }
  };

  const handleBulkAction = async (action: "change_stage" | "assign" | "delete", value?: number) => {
    if (action === "delete") {
      const ids = [...selectedIds];
      const count = ids.length;
      executeUndo(
        `${count} lead${count !== 1 ? "s" : ""} deleted.`,
        async () => {
          await bulkAction.mutateAsync({ data: { leadIds: ids, action: "delete" } });
          setPendingDeleteIds(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; });
          refetch();
        },
        () => {
          setPendingDeleteIds(s => new Set([...s, ...ids]));
          setSelectedIds([]);
        },
        () => {
          setPendingDeleteIds(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; });
          setSelectedIds(ids);
        },
      );
      return;
    }
    try {
      await bulkAction.mutateAsync({
        data: {
          leadIds: selectedIds,
          action,
          stageId: action === "change_stage" ? value : undefined,
          ownerId: action === "assign" ? value : undefined,
        }
      });
      toast({ title: "Bulk action successful" });
      setSelectedIds([]);
      refetch();
    } catch (e) {
      toast({ title: "Action failed", variant: "destructive" });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      let rows: Record<string, string>[];

      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "xlsx" || ext === "xls") {
        // Dynamically import xlsx to avoid adding it to the main bundle
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = (XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]).map(r =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])),
        );
      } else {
        rows = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results: Papa.ParseResult<Record<string, string>>) => resolve(results.data),
            error: reject,
          });
        });
      }

      const res = await importLeads.mutateAsync({ data: { rows, dryRun: true } as any });
      setImportParsedRows(rows);
      setImportValidation({ valid: (res as any).valid ?? rows.length, failed: (res as any).failed ?? 0, errors: (res as any).errors ?? [] });
      setImportPhase("preview");
    } catch {
      toast({ title: "Validation failed", description: "Could not parse the file. Make sure it's a valid CSV, XLS, or XLSX.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleImportConfirm = async () => {
    setImportPhase("importing");
    try {
      const res = await importLeads.mutateAsync({ data: { rows: importParsedRows } });
      toast({ title: "Import complete", description: `Created: ${res.created}, Failed: ${res.failed}` });
      setImportOpen(false);
      setImportPhase("upload");
      setImportValidation(null);
      setImportParsedRows([]);
      refetch();
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
      setImportPhase("preview");
    }
  };

  const hasFilters = stageId !== "all" || priority !== "all" || channel !== "all" || tagId !== "all" || ownerFilter !== "all" || !!locationFilter || !!industryFilter || !!dateFrom || !!dateTo || !!sourceFilter || statusFilter !== "all" || unassignedFilter || !!missingFilter || staleFilter || !!followupDue;
  const activeFilterCount = [stageId !== "all", priority !== "all", channel !== "all", tagId !== "all", ownerFilter !== "all", !!locationFilter, !!industryFilter, !!dateFrom || !!dateTo, !!sourceFilter, statusFilter !== "all", unassignedFilter, !!missingFilter, staleFilter, !!followupDue].filter(Boolean).length;

  const [exporting, setExporting] = useState(false);

  const handleExportLeads = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (stageId !== "all") params.set("stageId", stageId);
      if (priority !== "all") params.set("priority", priority);
      if (channel !== "all") params.set("channel", channel);
      if (tagId !== "all") params.set("tagId", tagId);
      if (ownerFilter !== "all" && ownerFilter !== "unassigned") params.set("ownerId", ownerFilter);
      if (ownerFilter === "unassigned" || unassignedFilter) params.set("unassigned", "true");
      if (locationFilter) params.set("location", locationFilter);
      if (industryFilter) params.set("industry", industryFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (missingFilter) params.set("missing", missingFilter);
      if (staleFilter) params.set("stale", "true");
      if (followupDue) params.set("followupDue", followupDue);

      const res = await fetch(`/api/leads/export?${params.toString()}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const data = await res.json();
      const rows: any[] = data.leads ?? [];

      const XLSX = await import("xlsx");

      // ── Sheet 1: "Sheet1" — mirrors the import template EXACTLY ────────────
      // Column names, order, and sheet name match Lead_Import_Format.xlsx so
      // the user can re-import the exported file with zero changes.
      const mainHeaders = [
        "Sl No", "Date", "Company Name", "Poc Name", "Designation",
        "Linkedin profile link", "Contact Number", "Mail Id", "Address",
        "Remark", "Comment", "Industry", "Priority", "Lead source",
        "Website", "Deal Value", "Expected closure date",
      ];
      const mainRows = rows.map((r: any, i: number) => [
        i + 1,                                                                        // Sl No
        r.createdAt ? format(parseISO(r.createdAt), "yyyy-MM-dd") : "",              // Date
        r.companyName ?? "",                                                          // Company Name
        r.contactPerson ?? "",                                                        // Poc Name
        r.designation ?? "",                                                          // Designation
        r.linkedinUrl ?? "",                                                          // Linkedin profile link
        r.phone ?? "",                                                                // Contact Number
        r.email ?? "",                                                                // Mail Id
        r.location ?? "",                                                             // Address
        r.remarks ?? "",                                                              // Remark
        "",                                                                           // Comment (separate notes — blank; re-import uses Remark)
        r.industry ?? "",                                                             // Industry
        r.priority ?? "",                                                             // Priority
        r.source ?? "",                                                               // Lead source
        r.websiteUrl ?? "",                                                           // Website
        r.valueAmount ?? "",                                                          // Deal Value
        r.expectedCloseDate ? format(parseISO(r.expectedCloseDate), "yyyy-MM-dd") : "", // Expected closure date
      ]);
      const mainData = [mainHeaders, ...mainRows];
      const wsMain = XLSX.utils.aoa_to_sheet(mainData);
      wsMain["!cols"] = mainHeaders.map((_: any, ci: number) => ({
        wch: Math.min(40, Math.max(12, ...mainData.map((row) => String(row[ci] ?? "").length))),
      }));

      // ── Sheet 2: "Additional Details" — CRM-specific fields not in the template ──
      const detailHeaders = ["Sl No", "Company Name", "Stage", "Owner", "Channel"];
      const detailRows = rows.map((r: any, i: number) => [
        i + 1,
        r.companyName ?? "",
        r.stageName ?? "",
        r.ownerName ?? "",
        r.channel ?? "",
      ]);
      const detailData = [detailHeaders, ...detailRows];
      const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
      wsDetail["!cols"] = detailHeaders.map((_: any, ci: number) => ({
        wch: Math.min(40, Math.max(12, ...detailData.map((row) => String(row[ci] ?? "").length))),
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsMain, "Sheet1");
      XLSX.utils.book_append_sheet(wb, wsDetail, "Additional Details");
      const dateTag = format(new Date(), "yyyy-MM-dd");
      XLSX.writeFile(wb, `leads-export-${dateTag}.xlsx`);
      toast({ title: `Exported ${rows.length} lead${rows.length !== 1 ? "s" : ""}` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleExportSelected = () => {
    const selected = (leadsData?.leads || []).filter(l => selectedIds.includes(l.id));
    if (selected.length === 0) return;
    const headers = ["Company", "Contact", "Email", "Phone", "Stage", "Priority", "Source", "Owner", "Created"];
    const rows = selected.map(l => [
      l.companyName, l.contactPerson, l.email ?? "", l.phone ?? "",
      l.stageName ?? "", (l as any).priority ?? "", (l as any).channel ?? "",
      l.ownerName ?? "", l.createdAt ? format(parseISO(l.createdAt), "yyyy-MM-dd") : ""
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "leads-export.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Blur overlay while a single-lead delete API call is in flight */}
      {deleteLead.isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-medium">Deleting…</p>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">Manage and track your pipeline opportunities.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button variant="outline" onClick={handleExportLeads} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Export
          </Button>
          <Button variant="cta" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Lead
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* ── Bulk action bar — always on top when rows are selected ── */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border-b text-sm animate-in fade-in">
              <span className="font-semibold text-primary">{selectedIds.length} selected</span>
              <div className="h-4 w-px bg-border mx-1" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">Change Stage</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {stages?.map(s => (
                    <DropdownMenuItem key={s.id} onClick={() => handleBulkAction("change_stage", s.id)}>
                      {s.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">Assign To</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {users?.map((u: any) => (
                    <DropdownMenuItem key={u.id} onClick={() => handleBulkAction("assign", u.id)}>
                      {u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.username}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleExportSelected}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
              {(() => {
                const isAdmin = authUser?.role === "admin" || !!(authUser as any)?.isSuperAdmin;
                const canDeleteSelected = isAdmin || selectedIds.every(id => {
                  const lead = visibleLeads.find(l => l.id === id);
                  if (!lead) return false;
                  const uid = Number(authUser?.id);
                  return Number((lead as any).createdById) === uid || Number((lead as any).ownerId) === uid;
                });
                return canDeleteSelected && has("leads.delete") ? (
                  <Button variant="outline" size="sm" className="h-8 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => handleBulkAction("delete")}>
                    Delete
                  </Button>
                ) : null;
              })()}
            </div>
          )}

          {/* ── Main toolbar: search + stage + filter toggle ── */}
          <div className="flex flex-wrap items-center gap-2 p-4 border-b">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search companies, contacts..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={stageId} onValueChange={(v) => { setStageId(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Stages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {stages?.map(s => (
                  <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {authUser && (
              <Button
                variant={ownerFilter === String(authUser.id) ? "default" : "outline"}
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  const myId = String(authUser.id);
                  setOwnerFilter(prev => prev === myId ? "all" : myId);
                  setPage(1);
                }}
              >
                <Users className="h-4 w-4" />
                My Leads
              </Button>
            )}
            <Button
              variant={filterOpen || activeFilterCount > 0 ? "default" : "outline"}
              size="sm"
              className="h-9 gap-2"
              onClick={() => setFilterOpen(o => !o)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground gap-1" onClick={() => { setPriority("all"); setChannel("all"); setTagId("all"); setOwnerFilter("all"); setLocationFilter(""); setIndustryFilter(""); setDateFrom(""); setDateTo(""); setSourceFilter(""); setStatusFilter("all"); setUnassignedFilter(false); setMissingFilter(""); setStaleFilter(false); setFilterOpen(false); }}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          {/* ── Collapsible filter panel ── */}
          {filterOpen && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-muted/30 animate-in fade-in slide-in-from-top-1">
              <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
                <SelectTrigger className="w-[130px] bg-background">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  <SelectItem value="hot">🔥 Hot</SelectItem>
                  <SelectItem value="warm">🌡️ Warm</SelectItem>
                  <SelectItem value="cold">❄️ Cold</SelectItem>
                </SelectContent>
              </Select>
              <Select value={channel} onValueChange={(v) => { setChannel(v); setPage(1); }}>
                <SelectTrigger className="w-[140px] bg-background">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tags && tags.length > 0 && (
                <Select value={tagId} onValueChange={(v) => { setTagId(v); setPage(1); }}>
                  <SelectTrigger className="w-[130px] bg-background">
                    <SelectValue placeholder="Tag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tags</SelectItem>
                    {tags.map((t: any) => (
                      <SelectItem key={t.id} value={t.id.toString()}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={ownerFilter} onValueChange={(v) => { setOwnerFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px] bg-background">
                  <SelectValue placeholder="Owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users?.map(u => (
                    <SelectItem key={u.id} value={u.id.toString()}>{u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Location..."
                value={locationFilter}
                onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }}
                className="w-[130px] h-9 bg-background text-sm"
              />
              <IndustryFilter value={industryFilter} onChange={(v) => { setIndustryFilter(v); setPage(1); }} />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                title="From date"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                title="To date"
              />
            </div>
          )}

          {/* Active filter chips — shown for ALL active filters, whether set via URL or in-page UI */}
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-primary/5">
              <span className="text-xs text-muted-foreground font-medium shrink-0">Filtered by:</span>

              {/* Stage chip — most common URL-driven filter (dashboard pipeline clicks) */}
              {stageId !== "all" && (() => {
                const s = stages?.find(s => s.id.toString() === stageId);
                return (
                  <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">
                    Stage: {s?.name ?? stageId}
                    <button onClick={() => { setStageId("all"); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear stage filter">×</button>
                  </span>
                );
              })()}

              {/* Status chips (won / lost / active) */}
              {statusFilter === "won" && (
                <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                  Won leads <button onClick={() => { setStatusFilter("all"); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear status filter">×</button>
                </span>
              )}
              {statusFilter === "lost" && (
                <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded-full">
                  Lost leads <button onClick={() => { setStatusFilter("all"); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear status filter">×</button>
                </span>
              )}
              {statusFilter === "active" && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">
                  Active leads <button onClick={() => { setStatusFilter("all"); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear status filter">×</button>
                </span>
              )}

              {/* Priority */}
              {priority !== "all" && (
                <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 px-2 py-0.5 rounded-full">
                  Priority: {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  <button onClick={() => { setPriority("all"); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear priority filter">×</button>
                </span>
              )}

              {/* Channel / source */}
              {channel !== "all" && (
                <span className="inline-flex items-center gap-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 px-2 py-0.5 rounded-full">
                  Source: {CHANNEL_LABELS[channel] ?? channel}
                  <button onClick={() => { setChannel("all"); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear source filter">×</button>
                </span>
              )}

              {/* Owner */}
              {ownerFilter !== "all" && ownerFilter !== "unassigned" && (() => {
                const u = (users as any[])?.find((u: any) => u.id.toString() === ownerFilter);
                const name = u
                  ? (u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.username)
                  : ownerFilter;
                return (
                  <span className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300 px-2 py-0.5 rounded-full">
                    Owner: {name}
                    <button onClick={() => { setOwnerFilter("all"); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear owner filter">×</button>
                  </span>
                );
              })()}

              {/* Unassigned */}
              {unassignedFilter && (
                <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full">
                  Unassigned only <button onClick={() => { setUnassignedFilter(false); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear unassigned filter">×</button>
                </span>
              )}

              {/* Location */}
              {!!locationFilter && (
                <span className="inline-flex items-center gap-1 text-xs bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300 px-2 py-0.5 rounded-full">
                  Location: {locationFilter}
                  <button onClick={() => { setLocationFilter(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear location filter">×</button>
                </span>
              )}

              {/* Industry */}
              {!!industryFilter && (
                <span className="inline-flex items-center gap-1 text-xs bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300 px-2 py-0.5 rounded-full">
                  Industry: {decodeIndustrySelection(industryFilter).join(", ")}
                  <button onClick={() => { setIndustryFilter(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear industry filter">×</button>
                </span>
              )}

              {/* Date range */}
              {(!!dateFrom || !!dateTo) && (
                <span className="inline-flex items-center gap-1 text-xs bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300 px-2 py-0.5 rounded-full">
                  {dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFrom ? `From ${dateFrom}` : `Until ${dateTo}`}
                  <button onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear date filter">×</button>
                </span>
              )}

              {/* Missing field */}
              {missingFilter === "email" && (
                <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 px-2 py-0.5 rounded-full">
                  Missing email <button onClick={() => { setMissingFilter(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear missing filter">×</button>
                </span>
              )}
              {missingFilter === "dealValue" && (
                <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 px-2 py-0.5 rounded-full">
                  Missing deal value <button onClick={() => { setMissingFilter(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear missing filter">×</button>
                </span>
              )}

              {/* Stale */}
              {staleFilter && (
                <span className="inline-flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                  Stale (30+ days) <button onClick={() => { setStaleFilter(false); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear stale filter">×</button>
                </span>
              )}

              {/* Follow-up due bucket */}
              {followupDue === "overdue" && (
                <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded-full">
                  Follow-ups: Overdue <button onClick={() => { setFollowupDue(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear follow-up filter">×</button>
                </span>
              )}
              {followupDue === "today" && (
                <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full">
                  Follow-ups: Due Today <button onClick={() => { setFollowupDue(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear follow-up filter">×</button>
                </span>
              )}
              {followupDue === "week" && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">
                  Follow-ups: Due This Week <button onClick={() => { setFollowupDue(""); setPage(1); }} className="ml-0.5 opacity-70 hover:opacity-100" aria-label="Clear follow-up filter">×</button>
                </span>
              )}
            </div>
          )}

          {/* Desktop skeleton */}
          {loadingLeads && (
            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] px-4"></TableHead>
                    <TableHead>Company & Contact</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-4"><Skeleton className="h-4 w-4 rounded" /></TableCell>
                      <TableCell><div className="space-y-1"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-24" /></div></TableCell>
                      <TableCell><Skeleton className="h-5 w-12 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {/* Mobile skeleton */}
          {loadingLeads && (
            <div className="sm:hidden divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loadingLeads && leadsData?.leads.length === 0 && (
            <Empty className="my-6 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Users className="h-5 w-5" /></EmptyMedia>
                <EmptyTitle>No leads found</EmptyTitle>
                <EmptyDescription>
                  {search || hasFilters
                    ? "No leads match your current filters. Try adjusting your search."
                    : "Your pipeline is empty — add your first lead to get started."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !hasFilters && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                      <Upload className="mr-2 h-4 w-4" aria-hidden="true" />Import CSV
                    </Button>
                    <Button variant="cta" size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Add Lead
                    </Button>
                  </div>
                )}
              </EmptyContent>
            </Empty>
          )}

          {/* Desktop Table */}
          {!loadingLeads && (leadsData?.leads.length ?? 0) > 0 && (
            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] px-4">
                      <Checkbox
                        checked={visibleLeads.length > 0 && selectedIds.length === visibleLeads.length}
                        onCheckedChange={toggleAll}
                        aria-label="Select all leads"
                      />
                    </TableHead>
                    <TableHead>Company & Contact</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLeads.map((lead) => (
                    <TableRow key={lead.id} className="group">
                      <TableCell className="px-4">
                        <Checkbox
                          checked={selectedIds.includes(lead.id)}
                          onCheckedChange={(c) => toggleOne(lead.id, !!c)}
                          aria-label={`Select ${lead.companyName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={`/leads/${lead.id}`}>
                          <div className="cursor-pointer">
                            <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{lead.companyName}</div>
                            <div className="text-sm text-muted-foreground">{lead.contactPerson}</div>
                            {(lead as any).tags?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {(lead as any).tags.map((tag: any) => (
                                  <span key={tag.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}>
                                    {tag.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <select
                          value={(lead as any).priority ?? ""}
                          onChange={e => handleInlineFieldChange(lead.id, "priority", e.target.value || null)}
                          className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">—</option>
                          <option value="hot">🔥 Hot</option>
                          <option value="warm">🌡️ Warm</option>
                          <option value="cold">❄️ Cold</option>
                        </select>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <select
                          value={lead.stageId?.toString() ?? ""}
                          onChange={e => handleInlineStageChange(lead.id, Number(e.target.value))}
                          className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring max-w-[130px]"
                          style={{ color: lead.stageColor || undefined }}
                        >
                          {stages?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <select
                          value={(lead as any).channel ?? ""}
                          onChange={e => handleInlineFieldChange(lead.id, "channel", e.target.value || null)}
                          className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">—</option>
                          {Object.entries(CHANNEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        {canAssignOwner ? (
                          <select
                            value={lead.ownerId ? String(lead.ownerId) : ""}
                            onChange={e => handleInlineOwnerChange(lead.id, e.target.value)}
                            className="text-xs rounded-md border border-input bg-background px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring max-w-[150px]"
                          >
                            <option value="">Unassigned</option>
                            {users?.map((u: any) => (
                              <option key={u.id} value={String(u.id)}>
                                {u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.username}
                              </option>
                            ))}
                          </select>
                        ) : lead.ownerId ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6 flex-shrink-0">
                              <AvatarFallback className="text-[10px]">{lead.ownerName?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm truncate max-w-[100px]">{lead.ownerName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(parseISO(lead.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8" aria-label={`Actions for ${lead.companyName}`}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/leads/${lead.id}`}>View</Link>
                            </DropdownMenuItem>
                            {(() => {
                              const isAdmin = authUser?.role === "admin" || !!(authUser as any)?.isSuperAdmin;
                              const uid = Number(authUser?.id);
                              const canDel = has("leads.delete") && (isAdmin || Number((lead as any).createdById) === uid || Number(lead.ownerId) === uid);
                              return canDel ? (
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteLeadRow(lead.id, lead.companyName)}>
                                  Delete
                                </DropdownMenuItem>
                              ) : null;
                            })()}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Mobile Card View */}
          {!loadingLeads && visibleLeads.length > 0 && (
            <div className="sm:hidden divide-y">
              {visibleLeads.map((lead) => (
                <Link key={lead.id} href={`/leads/${lead.id}`}>
                  <div className="p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{lead.companyName}</p>
                          <PriorityBadge priority={(lead as any).priority} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{lead.contactPerson}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[10px] py-0" style={{ backgroundColor: `${lead.stageColor}15`, color: lead.stageColor || 'inherit', borderColor: `${lead.stageColor}30` }}>
                            {lead.stageName}
                          </Badge>
                          {lead.ownerName && (
                            <span className="text-xs text-muted-foreground">{lead.ownerName}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{format(parseISO(lead.createdAt), "MMM d")}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {leadsData && leadsData.total > leadsData.limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>Showing {((page - 1) * leadsData.limit) + 1}–{Math.min(page * leadsData.limit, leadsData.total)} of {leadsData.total}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page * leadsData.limit >= leadsData.total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) { setImportPhase("upload"); setImportValidation(null); setImportParsedRows([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Leads</DialogTitle>
            <DialogDescription>
              {importPhase === "upload"
                ? "Upload a CSV, XLS, or XLSX file. Column names are detected automatically — any header format is accepted."
                : importPhase === "preview"
                ? "Review validation results before importing."
                : "Importing…"}
            </DialogDescription>
          </DialogHeader>

          {importPhase === "upload" && (
            <div className="py-6 space-y-3">
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} disabled={importing} />
              <p className="text-xs text-muted-foreground text-center">
                Supports <strong>CSV</strong>, <strong>Excel (.xlsx / .xls)</strong> · Column names auto-detected
                (Company, Contact, Mobile, Email, City, Industry, etc.)
              </p>
            </div>
          )}

          {importing && importPhase === "upload" && (
            <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Validating…
            </div>
          )}

          {importPhase === "preview" && importValidation && (
            <div className="space-y-4 py-2">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-medium">{importValidation.valid} rows valid</span>
                {importValidation.failed > 0 && <span className="text-destructive font-medium">{importValidation.failed} issues</span>}
              </div>
              {importValidation.errors.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 text-xs space-y-1 p-3">
                  {importValidation.errors.map((e, i) => (
                    <div key={i} className="text-destructive">Row {e.row}: {e.message}</div>
                  ))}
                </div>
              )}
              {importValidation.valid === 0 && (
                <p className="text-sm text-muted-foreground">No valid rows to import. Fix the issues above and try again.</p>
              )}
            </div>
          )}

          {importPhase === "importing" && (
            <div className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Importing leads…
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportPhase("upload"); setImportValidation(null); setImportParsedRows([]); }}>Cancel</Button>
            {importPhase === "preview" && importValidation && importValidation.valid > 0 && (
              <Button variant="cta" onClick={handleImportConfirm}>
                Import {importValidation.valid} Lead{importValidation.valid !== 1 ? "s" : ""}
              </Button>
            )}
            {importPhase === "preview" && importValidation && importValidation.valid === 0 && (
              <Button variant="outline" onClick={() => { setImportPhase("upload"); setImportValidation(null); setImportParsedRows([]); }}>Try Again</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) { setCreateFormErrors({}); setCreateServerError(null); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newCompanyName">Company Name <span className="text-destructive">*</span></Label>
                <Input
                  id="newCompanyName"
                  value={formData.companyName}
                  onChange={(e) => setFormData({...formData, companyName: e.target.value})}
                  placeholder="Acme Corp"
                  aria-invalid={!!createFormErrors.companyName}
                  className={createFormErrors.companyName ? "border-destructive" : ""}
                />
                {createFormErrors.companyName && <p className="text-xs text-destructive">{createFormErrors.companyName}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newContactPerson">Contact Person <span className="text-destructive">*</span></Label>
                <Input
                  id="newContactPerson"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({...formData, contactPerson: e.target.value})}
                  placeholder="John Smith"
                  aria-invalid={!!createFormErrors.contactPerson}
                  className={createFormErrors.contactPerson ? "border-destructive" : ""}
                />
                {createFormErrors.contactPerson && <p className="text-xs text-destructive">{createFormErrors.contactPerson}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newEmail">Email</Label>
                <Input
                  id="newEmail"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  placeholder="john@acme.com"
                  aria-invalid={!!createFormErrors.email}
                  className={createFormErrors.email ? "border-destructive" : ""}
                />
                {createFormErrors.email && <p className="text-xs text-destructive">{createFormErrors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newPhone">Phone</Label>
                <Input id="newPhone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} placeholder="+1 555 0000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newLocation">Location</Label>
                <Input id="newLocation" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} placeholder="City, Country" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newDesignation">Designation</Label>
                <Input id="newDesignation" value={formData.designation} onChange={(e) => setFormData({...formData, designation: e.target.value})} placeholder="CEO, Director..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newIndustry">Industry</Label>
                <IndustrySelect value={formData.industry} onChange={(v) => setFormData({...formData, industry: v})} />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <PrioritySelect value={formData.priority} onChange={(v) => setFormData({...formData, priority: v})} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newChannel">Lead Source</Label>
                <select
                  id="newChannel"
                  value={formData.channel ?? ""}
                  onChange={e => setFormData({...formData, channel: e.target.value || null})}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select source...</option>
                  {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newLinkedin">LinkedIn URL</Label>
                <Input
                  id="newLinkedin"
                  value={formData.linkedinUrl}
                  onChange={(e) => setFormData({...formData, linkedinUrl: e.target.value})}
                  placeholder="https://linkedin.com/in/..."
                  aria-invalid={!!createFormErrors.linkedinUrl}
                  className={createFormErrors.linkedinUrl ? "border-destructive" : ""}
                />
                {createFormErrors.linkedinUrl && <p className="text-xs text-destructive">{createFormErrors.linkedinUrl}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="newDealValue">Deal Value</Label>
                <Input
                  id="newDealValue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.valueAmount}
                  onChange={(e) => setFormData({...formData, valueAmount: e.target.value})}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newCloseDate">Expected Close Date <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <div className="flex gap-1.5">
                  <Input
                    id="newCloseDate"
                    type="date"
                    value={formData.expectedCloseDate}
                    onChange={(e) => setFormData({...formData, expectedCloseDate: e.target.value})}
                    className="flex-1"
                  />
                  {formData.expectedCloseDate && (
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => setFormData({...formData, expectedCloseDate: ""})}>
                      ×
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newWebsite">Website</Label>
              <Input
                id="newWebsite"
                value={formData.websiteUrl}
                onChange={(e) => setFormData({...formData, websiteUrl: e.target.value})}
                placeholder="https://acme.com"
                aria-invalid={!!createFormErrors.websiteUrl}
                className={createFormErrors.websiteUrl ? "border-destructive" : ""}
              />
              {createFormErrors.websiteUrl && <p className="text-xs text-destructive">{createFormErrors.websiteUrl}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newRemarks">Remark</Label>
              <textarea
                id="newRemarks"
                value={formData.remarks}
                onChange={(e) => setFormData({...formData, remarks: e.target.value})}
                placeholder="Additional notes..."
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newComment">Comment</Label>
              <textarea
                id="newComment"
                value={formData.comment}
                onChange={(e) => setFormData({...formData, comment: e.target.value})}
                placeholder="Internal comment..."
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </div>
          {createServerError && (
            <p className="text-sm text-destructive px-1 -mb-2" role="alert">{createServerError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleCreateLead} disabled={createLead.isPending}>
              {createLead.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : "Create Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
