import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDeal, useListDealNotes, useCreateDealNote,
  useListDealRevenueEntries, useCreateDealRevenueEntry,
  useUpdateDealRevenueEntry, useDeleteDealRevenueEntry,
  getListDealRevenueEntriesUrl,
  type DealRevenueEntry,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Loader2, User, Building2, IndianRupee, Calendar, Plus, MoreHorizontal, TrendingUp, Pencil, Trash2, Download, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permission";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

type NoteType = "note" | "email" | "call";

const NOTE_TYPES: { value: NoteType; label: string; color: string }[] = [
  { value: "note", label: "Note", color: "bg-gray-100 text-gray-700" },
  { value: "email", label: "Email", color: "bg-blue-100 text-blue-700" },
  { value: "call", label: "Call", color: "bg-green-100 text-green-700" },
];

function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "₹0";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(n)) return String(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(n);
}

// ── Revenue Entry form state ──────────────────────────────────────────────────
const EMPTY_ENTRY = { amount: "", month: "", note: "" };

function todayMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Build cumulative chart data from a sorted list of entries
function buildChartData(entries: DealRevenueEntry[]) {
  // Group by month (ISO date string already YYYY-MM-DD)
  const byMonth: Record<string, number> = {};
  for (const e of entries) {
    const key = e.month.slice(0, 7); // "2026-07"
    byMonth[key] = (byMonth[key] ?? 0) + parseFloat(e.amount ?? "0");
  }
  const keys = Object.keys(byMonth).sort();
  let cumulative = 0;
  return keys.map(k => {
    cumulative += byMonth[k];
    return {
      month: format(new Date(k + "-01"), "MMM yy"),
      revenue: byMonth[k],
      cumulative,
    };
  });
}

export default function DealDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { has } = usePermissions();
  const canManageRevenue = has("revenue_entries.manage");

  const { data: deal, isLoading, refetch: refetchDeal } = useGetDeal(id);
  const { data: notes = [], refetch: refetchNotes } = useListDealNotes(id);
  const createNote = useCreateDealNote();

  const { data: revenueEntries = [], isLoading: loadingEntries } = useListDealRevenueEntries(id);
  const createEntry = useCreateDealRevenueEntry();
  const updateEntry = useUpdateDealRevenueEntry();
  const deleteEntry = useDeleteDealRevenueEntry();

  const [noteType, setNoteType] = useState<NoteType>("note");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Revenue entry dialog state ──────────────────────────────────────────────
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DealRevenueEntry | null>(null);
  const [entryForm, setEntryForm] = useState(EMPTY_ENTRY);
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState<number | null>(null);

  // ── Revenue Log filter state ────────────────────────────────────────────────
  type FilterMode = "all" | "year" | "month" | "custom";
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterYear, setFilterYear] = useState<string>("");
  const [filterMonth, setFilterMonth] = useState<string>("");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  const invalidateRevenue = () => {
    queryClient.invalidateQueries({ queryKey: [getListDealRevenueEntriesUrl(id)] });
    refetchDeal(); // value is now computed — refresh deal header
  };

  const openAddEntry = () => {
    setEditingEntry(null);
    setEntryForm({ amount: "", month: todayMonthValue(), note: "" });
    setEntryDialogOpen(true);
  };

  const openEditEntry = (entry: DealRevenueEntry) => {
    setEditingEntry(entry);
    setEntryForm({
      amount: entry.amount,
      month: entry.month,
      note: entry.note ?? "",
    });
    setEntryDialogOpen(true);
  };

  const handleSaveEntry = async () => {
    if (!entryForm.amount || !entryForm.month) return;
    setEntrySubmitting(true);
    try {
      if (editingEntry) {
        await updateEntry.mutateAsync({
          dealId: id,
          entryId: editingEntry.id,
          data: {
            amount: entryForm.amount,
            month: entryForm.month,
            note: entryForm.note || null,
          },
        });
        toast({ title: "Entry updated" });
      } else {
        await createEntry.mutateAsync({
          dealId: id,
          data: {
            amount: entryForm.amount,
            month: entryForm.month,
            note: entryForm.note || undefined,
          },
        });
        toast({ title: "Revenue entry added" });
      }
      setEntryDialogOpen(false);
      invalidateRevenue();
    } catch {
      toast({ title: "Failed to save entry", variant: "destructive" });
    } finally {
      setEntrySubmitting(false);
    }
  };

  const handleDeleteEntry = async () => {
    if (deleteEntryId === null) return;
    try {
      await deleteEntry.mutateAsync({ dealId: id, entryId: deleteEntryId });
      toast({ title: "Entry deleted" });
      invalidateRevenue();
    } catch {
      toast({ title: "Failed to delete entry", variant: "destructive" });
    } finally {
      setDeleteEntryId(null);
    }
  };

  // ── Excel export ─────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (filteredEntries.length === 0) return;
    const XLSX = await import("xlsx");
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const fmt = (ym: string) => { const [y, m] = ym.split("-"); return `${MONTHS[parseInt(m,10)-1]} ${y}`; };

    const sorted = [...filteredEntries].sort((a, b) => b.month.localeCompare(a.month));

    const wsData: (string | number)[][] = [
      ["Deal",        deal!.name ?? "—"],
      ["Account",     deal!.accountName ?? "—"],
      ["Period",      filterLabel],
      ["Total (₹)",   filteredTotal],
      ["Exported on", format(new Date(), "d MMM yyyy")],
      [],
      ["Month", "Amount (₹)", "Note", "Added By", "Date Added"],
      ...sorted.map(e => [
        fmt(e.month.slice(0, 7)),
        parseFloat(e.amount ?? "0"),
        e.note ?? "",
        (e as any).createdByName ?? "",
        (e as any).createdAt ? format(new Date((e as any).createdAt), "d MMM yyyy") : "",
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 42 }, { wch: 22 }, { wch: 16 }];

    // Bold the summary labels in column A (rows 1-5) and the header row (row 7)
    ["A1","A2","A3","A4","A5","A7","B7","C7","D7","E7"].forEach(ref => {
      if (ws[ref]) ws[ref].s = { font: { bold: true } };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Revenue Log");

    const safeName   = (deal!.name ?? "deal").replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const safePeriod = filterLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    XLSX.writeFile(wb, `revenue-log-${safeName}-${safePeriod}.xlsx`);
  };

  // ── Revenue Log derived values (useMemo must stay above early returns) ────────
  // Distinct years from entries, descending — used to populate year/month dropdowns
  const availableYears = useMemo(
    () => [...new Set(revenueEntries.map(e => e.month.slice(0, 4)))].sort().reverse(),
    [revenueEntries],
  );

  // Apply the active filter against entry.month (YYYY-MM-DD)
  const filteredEntries = useMemo(() => {
    if (filterMode === "year" && filterYear)
      return revenueEntries.filter(e => e.month.slice(0, 4) === filterYear);
    if (filterMode === "month" && filterYear && filterMonth)
      return revenueEntries.filter(e => e.month.slice(0, 7) === `${filterYear}-${filterMonth}`);
    if (filterMode === "custom" && filterFrom && filterTo) {
      const ym = (e: { month: string }) => e.month.slice(0, 7);
      return revenueEntries.filter(e => ym(e) >= filterFrom && ym(e) <= filterTo);
    }
    return revenueEntries;
  }, [revenueEntries, filterMode, filterYear, filterMonth, filterFrom, filterTo]);

  const isFiltered    = filterMode !== "all";
  const totalRevenue  = revenueEntries.reduce((s: number, e) => s + parseFloat(e.amount ?? "0"), 0);
  const filteredTotal = filteredEntries.reduce((s: number, e) => s + parseFloat(e.amount ?? "0"), 0);

  // Human-readable label for the active period — used in badge + export filename/summary
  const filterLabel = (() => {
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if (filterMode === "year" && filterYear) return filterYear;
    if (filterMode === "month" && filterYear && filterMonth)
      return `${MONTHS[parseInt(filterMonth, 10) - 1]} ${filterYear}`;
    if (filterMode === "custom" && filterFrom && filterTo) {
      const fmt = (ym: string) => { const [y, m] = ym.split("-"); return `${MONTHS[parseInt(m,10)-1]} ${y}`; };
      return `${fmt(filterFrom)} – ${fmt(filterTo)}`;
    }
    return "All time";
  })();

  // Helper: activate a filter mode and seed sensible defaults the first time
  const activateFilter = (mode: FilterMode) => {
    setFilterMode(mode);
    if ((mode === "year" || mode === "month") && !filterYear && availableYears[0])
      setFilterYear(availableYears[0]);
    if (mode === "month" && !filterMonth)
      setFilterMonth(String(new Date().getMonth() + 1).padStart(2, "0"));
  };

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await createNote.mutateAsync({ dealId: id, data: { type: noteType, content: content.trim() } });
      setContent("");
      refetchNotes();
      toast({ title: `${noteType === "email" ? "Email" : noteType === "call" ? "Call" : "Note"} logged` });
    } catch {
      toast({ title: "Failed to log", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!deal) {
    return <div className="p-6 text-muted-foreground">Deal not found.</div>;
  }

  const formattedValue = deal.value
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(deal.value))
    : null;

  const chartData = buildChartData(filteredEntries); // chart always reflects active filter

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/deals")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Deals
        </Button>
      </div>

      {/* Deal header */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold">{deal.name}</h1>
                {deal.stageName && (
                  <Badge
                    className="mt-1.5 text-xs"
                    style={deal.stageColor ? { backgroundColor: deal.stageColor + "22", color: deal.stageColor, borderColor: deal.stageColor + "44" } : undefined}
                    variant="outline"
                  >
                    {deal.stageName}
                  </Badge>
                )}
              </div>
              {formattedValue && (
                <span className="text-2xl font-bold text-primary shrink-0">{formattedValue}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              {deal.accountName && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> {deal.accountName}
                </span>
              )}
              {deal.contactName && (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" /> {deal.contactName}
                </span>
              )}
              {deal.ownerName && (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" /> {deal.ownerName}
                </span>
              )}
              {deal.closeDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Close: {format(parseISO(deal.closeDate), "MMM d, yyyy")}
                </span>
              )}
              {deal.probability != null && (
                <span className="flex items-center gap-1.5">
                  <IndianRupee className="h-3.5 w-3.5" /> {deal.probability}% probability
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revenue Log ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Left: title + totals */}
            <div className="flex items-center gap-2 flex-wrap">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Revenue Log</CardTitle>
              {/* All-time total — always shown when non-zero */}
              {totalRevenue !== 0 && (
                <Badge variant="secondary" className={`text-xs font-semibold ${totalRevenue < 0 ? "text-red-500 dark:text-red-400" : ""}`}>
                  {formatCurrency(totalRevenue)} total
                </Badge>
              )}
              {/* Filtered total — shown alongside when a filter is active and the numbers differ */}
              {isFiltered && filteredTotal !== totalRevenue && (
                <Badge variant="outline" className={`text-xs font-medium ${filteredTotal < 0 ? "text-red-500 dark:text-red-400" : "text-primary"}`}>
                  {formatCurrency(filteredTotal)} · {filterLabel}
                </Badge>
              )}
            </div>
            {/* Right: Export + Add Entry */}
            <div className="flex items-center gap-1.5">
              {revenueEntries.length > 0 && (
                <Button size="sm" variant="ghost" onClick={handleExport} className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
              )}
              {canManageRevenue && (
                <Button size="sm" variant="outline" onClick={openAddEntry} className="h-7 gap-1 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Add Entry
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {loadingEntries ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : revenueEntries.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {canManageRevenue
                ? "No revenue entries yet. Add the first one to start tracking."
                : "No revenue entries recorded for this deal."}
            </div>
          ) : (
            <>
              {/* ── Filter bar ──────────────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
                {/* Mode toggle */}
                <div className="flex rounded-md border text-xs overflow-hidden shrink-0">
                  {(["all", "year", "month", "custom"] as FilterMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      className={`px-2.5 py-1 transition-colors ${
                        filterMode === mode
                          ? "bg-primary text-primary-foreground font-medium"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                      onClick={() => activateFilter(mode)}
                    >
                      {mode === "all" ? "All" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Year picker */}
                {(filterMode === "year" || filterMode === "month") && (
                  <select
                    className="text-xs border rounded-md px-2 py-1 bg-background h-7"
                    value={filterYear}
                    onChange={e => setFilterYear(e.target.value)}
                  >
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}

                {/* Month picker */}
                {filterMode === "month" && (
                  <select
                    className="text-xs border rounded-md px-2 py-1 bg-background h-7"
                    value={filterMonth}
                    onChange={e => setFilterMonth(e.target.value)}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const m = String(i + 1).padStart(2, "0");
                      const label = new Date(`2000-${m}-01`).toLocaleString("en-IN", { month: "long" });
                      return <option key={m} value={m}>{label}</option>;
                    })}
                  </select>
                )}

                {/* Custom range */}
                {filterMode === "custom" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="month"
                      className="text-xs border rounded-md px-2 py-1 bg-background h-7"
                      value={filterFrom}
                      onChange={e => setFilterFrom(e.target.value)}
                      max={filterTo || undefined}
                    />
                    <span className="text-xs text-muted-foreground">→</span>
                    <input
                      type="month"
                      className="text-xs border rounded-md px-2 py-1 bg-background h-7"
                      value={filterTo}
                      onChange={e => setFilterTo(e.target.value)}
                      min={filterFrom || undefined}
                    />
                  </div>
                )}

                {/* Live filtered summary — right-aligned */}
                {isFiltered && (filterMode !== "custom" || (filterFrom && filterTo)) && (
                  <div className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
                    <span>
                      {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
                      {" · "}
                      <span className={`font-semibold ${filteredTotal < 0 ? "text-red-500 dark:text-red-400" : "text-foreground"}`}>
                        {formatCurrency(filteredTotal)}
                      </span>
                      {" for "}{filterLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setFilterMode("all"); setFilterYear(""); setFilterMonth(""); setFilterFrom(""); setFilterTo(""); }}
                      className="rounded-full p-0.5 hover:bg-muted transition-colors"
                      title="Clear filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* ── No results for active filter ────────────────────────────── */}
              {filteredEntries.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No entries for {filterLabel}.
                </div>
              ) : (
                <>
                  {/* Cumulative chart — reflects active filter */}
                  {chartData.length > 1 && (
                    <div className="h-40 -mx-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                            width={48}
                          />
                          <RechartsTooltip
                            formatter={(val: number) => [formatCurrency(val), "Cumulative"]}
                            contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          />
                          <Area
                            type="monotone"
                            dataKey="cumulative"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            fill="url(#revenueGrad)"
                            dot={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Entry list — sorted by month desc, uses filtered set */}
                  <div className="divide-y">
                    {[...filteredEntries]
                      .sort((a, b) => b.month.localeCompare(a.month))
                      .map(entry => (
                        <div key={entry.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-semibold ${parseFloat(entry.amount ?? "0") < 0 ? "text-red-500 dark:text-red-400" : "text-primary"}`}>
                                {formatCurrency(entry.amount)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(entry.month), "MMMM yyyy")}
                              </span>
                              {entry.createdByName && (
                                <span className="text-xs text-muted-foreground ml-auto">
                                  {entry.createdByName}
                                </span>
                              )}
                            </div>
                            {entry.note && (
                              <p className="text-sm text-muted-foreground mt-0.5 truncate">{entry.note}</p>
                            )}
                          </div>
                          {canManageRevenue && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditEntry(entry)}>
                                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleteEntryId(entry.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Activity Log (notes) ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Log Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {NOTE_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setNoteType(t.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                  noteType === t.value ? t.color + " border-transparent" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Textarea
            placeholder={noteType === "email" ? "Email content or summary…" : noteType === "call" ? "Call notes…" : "Add a note…"}
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSubmit} disabled={!content.trim() || submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Log {noteType === "email" ? "Email" : noteType === "call" ? "Call" : "Note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {notes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...notes].reverse().map(note => {
                const typeInfo = NOTE_TYPES.find(t => t.value === note.type) ?? NOTE_TYPES[0];
                return (
                  <div key={note.id} className="flex gap-3">
                    <Avatar className="h-7 w-7 mt-0.5 shrink-0">
                      <AvatarFallback className="text-xs">
                        {note.createdByName ? note.createdByName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{note.createdByName ?? "Unknown"}</span>
                        <Badge variant="outline" className={`text-xs px-1.5 py-0 ${typeInfo.color} border-transparent`}>
                          {typeInfo.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {format(parseISO(note.createdAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add / Edit revenue entry dialog ──────────────────────────────────── */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Edit Revenue Entry" : "Add Revenue Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="entry-amount">
                Amount (₹) *{" "}
                <span className="text-xs text-muted-foreground font-normal">use negative for a loss</span>
              </Label>
              <Input
                id="entry-amount"
                type="number"
                placeholder="e.g. 150000 or -25000 for a loss"
                value={entryForm.amount}
                onChange={e => setEntryForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-month">Month *</Label>
              <Input
                id="entry-month"
                type="month"
                value={entryForm.month.slice(0, 7)} // YYYY-MM for the input
                onChange={e =>
                  setEntryForm(f => ({ ...f, month: e.target.value ? e.target.value + "-01" : "" }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-note">Note</Label>
              <Textarea
                id="entry-note"
                placeholder="Optional note or description…"
                value={entryForm.note}
                onChange={e => setEntryForm(f => ({ ...f, note: e.target.value }))}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveEntry}
              disabled={!entryForm.amount || !entryForm.month || entrySubmitting}
            >
              {entrySubmitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {editingEntry ? "Save Changes" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog ──────────────────────────────────────────────── */}
      <AlertDialog open={deleteEntryId !== null} onOpenChange={open => { if (!open) setDeleteEntryId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Revenue Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the entry and recalculate the deal value. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEntry} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
