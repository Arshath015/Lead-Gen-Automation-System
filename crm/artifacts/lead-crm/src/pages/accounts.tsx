import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount,
  getListAccountsQueryKey,
  type Account, type AccountInput,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useUndoAction } from "@/hooks/use-undo-action";
import { format, parseISO } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListUsers } from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permission";
import { Plus, Search, MoreHorizontal, Loader2, Building2, Globe, MapPin, Trash2, FileSpreadsheet } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EMPTY_FORM: AccountInput & { ownerId?: number } = { name: "", industry: "", website: "", size: "", phone: "", location: "", notes: "" };

function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function AccountCardSkeleton() {
  return (
    <div className="p-4 border-b last:border-b-0 space-y-2">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="space-y-1 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}

export default function Accounts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { execute: executeUndo } = useUndoAction();
  const { has } = usePermissions();
  const canEditOwner = has("contacts.edit");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [form, setForm] = useState<AccountInput & { ownerId?: number }>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Bulk select + undo-delete state ──────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useListAccounts({ search: search || undefined, page, limit: 20 });
  const { data: usersData } = useListUsers();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });

  const accounts = data?.accounts ?? [];
  const visibleAccounts = accounts.filter(a => !pendingDeleteIds.has(a.id));
  const isEmpty = !isLoading && visibleAccounts.length === 0 && pendingDeleteIds.size === 0 && accounts.length === 0;

  // ── Row selection ──────────────────────────────────────────────────────────
  const toggleAll = (checked: boolean) => {
    if (checked) setSelectedIds(visibleAccounts.map(a => a.id));
    else setSelectedIds([]);
  };
  const toggleOne = (id: number, checked: boolean) => {
    if (checked) setSelectedIds(prev => [...prev, id]);
    else setSelectedIds(prev => prev.filter(i => i !== id));
  };

  // ── Delete with 5-second undo window ──────────────────────────────────────
  const handleDeleteWithUndo = (id: number, name: string) => {
    executeUndo(
      `"${name}" deleted.`,
      async () => {
        await deleteAccount.mutateAsync({ id });
        setPendingDeleteIds(s => { const n = new Set(s); n.delete(id); return n; });
        invalidate();
      },
      () => setPendingDeleteIds(s => new Set([...s, id])),
      () => setPendingDeleteIds(s => { const n = new Set(s); n.delete(id); return n; }),
    );
  };

  const handleBulkDelete = () => {
    const ids = [...selectedIds];
    const count = ids.length;
    executeUndo(
      `${count} account${count !== 1 ? "s" : ""} deleted.`,
      async () => {
        await fetch(`${BASE}/api/accounts/bulk-delete`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
          body: JSON.stringify({ ids }),
        });
        setPendingDeleteIds(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; });
        invalidate();
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
  };

  // ── Export all filtered accounts to CSV ────────────────────────────────────
  const handleExportAccounts = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ limit: "9999" });
      if (search) params.set("search", search);
      const resp = await fetch(`${BASE}/api/accounts?${params}`, {
        credentials: "include",
        headers: { "X-CSRF-Protection": "1" },
      });
      const json = await resp.json();
      const rows = (json.accounts ?? []) as any[];
      exportCsv(
        "accounts.csv",
        ["Company Name", "Industry", "Website", "Location", "Phone", "Size", "Notes", "Added"],
        rows.map(a => [
          a.name,
          a.industry ?? "",
          a.website ?? "",
          a.location ?? "",
          a.phone ?? "",
          a.size ?? "",
          a.notes ?? "",
          a.createdAt ? new Date(a.createdAt).toLocaleDateString("en-IN") : "",
        ]),
      );
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // ── Create / Edit ──────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setServerError(null);
    setDialogOpen(true);
  };
  const openEdit = (a: Account) => {
    setEditTarget(a);
    setFormErrors({});
    setServerError(null);
    setForm({ name: a.name, industry: a.industry ?? "", website: a.website ?? "", size: a.size ?? "", phone: a.phone ?? "", location: a.location ?? "", notes: a.notes ?? "", ownerId: a.ownerId ?? undefined });
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.name?.trim()) errors.name = "Company name is required";
    if (form.website && !/^https?:\/\/.+/.test(form.website)) errors.website = "URL must start with http:// or https://";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    setServerError(null);
    if (!validateForm()) return;
    try {
      if (editTarget) {
        await updateAccount.mutateAsync({ id: editTarget.id, data: form });
        toast({ title: "Account updated" });
      } else {
        await createAccount.mutateAsync({ data: form });
        toast({ title: "Account created" });
      }
      setDialogOpen(false);
      invalidate();
    } catch (e: any) {
      setServerError(e.message ?? "An unexpected error occurred. Please try again.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground">Manage companies and organizations.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportAccounts} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Export
          </Button>
          <Button variant="cta" onClick={openCreate}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />New Account</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* ── Toolbar row: search + optional bulk bar ── */}
          <div className="flex items-center gap-2 p-4 border-b flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search accounts..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); setSelectedIds([]); }}
                aria-label="Search accounts"
              />
            </div>
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 ml-auto animate-in fade-in">
                <span className="text-sm font-semibold text-primary">{selectedIds.length} selected</span>
                <div className="h-4 w-px bg-border" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={handleBulkDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete {selectedIds.length}
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => setSelectedIds([])}>
                  Clear
                </Button>
              </div>
            )}
          </div>

          {/* Skeleton loaders */}
          {isLoading && (
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px] px-4" />
                      <TableHead>Name</TableHead>
                      <TableHead>Industry</TableHead>
                      <TableHead>Website</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="px-4"><Skeleton className="h-4 w-4" /></TableCell>
                        <TableCell><div className="flex items-center gap-2"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-28" /></div></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="md:hidden">
                {Array.from({ length: 5 }).map((_, i) => <AccountCardSkeleton key={i} />)}
              </div>
            </>
          )}

          {/* Empty state */}
          {isEmpty && (
            <Empty className="my-6 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Building2 className="h-5 w-5" /></EmptyMedia>
                <EmptyTitle>No accounts yet</EmptyTitle>
                <EmptyDescription>
                  {search ? `No accounts match "${search}".` : "Create your first account to track companies in your pipeline."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && (
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />New Account
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          )}

          {/* Desktop Table */}
          {!isLoading && visibleAccounts.length > 0 && (
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] px-4">
                      <Checkbox
                        checked={visibleAccounts.length > 0 && selectedIds.length === visibleAccounts.length}
                        onCheckedChange={toggleAll}
                        aria-label="Select all accounts"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Website</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleAccounts.map(a => (
                    <TableRow key={a.id} className="group">
                      <TableCell className="px-4">
                        <Checkbox
                          checked={selectedIds.includes(a.id)}
                          onCheckedChange={(checked) => toggleOne(a.id, !!checked)}
                          aria-label={`Select ${a.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
                          </div>
                          <span className="font-semibold">{a.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.industry ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {a.website ? <a href={a.website} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1"><Globe className="h-3 w-3" aria-hidden="true" />{a.website.replace(/^https?:\/\//, "")}</a> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.location ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{a.location}</span> : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.phone ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.size ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(parseISO(a.createdAt), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8" aria-label={`Actions for ${a.name}`}>
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(a)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDeleteWithUndo(a.id, a.name)}
                            >
                              Delete
                            </DropdownMenuItem>
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
          {!isLoading && visibleAccounts.length > 0 && (
            <div className="md:hidden divide-y">
              {visibleAccounts.map(a => (
                <div key={a.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{a.name}</p>
                        {a.industry && <p className="text-xs text-muted-foreground">{a.industry}</p>}
                        {a.location && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" aria-hidden="true" />{a.location}
                          </p>
                        )}
                        {a.website && (
                          <a href={a.website} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                            <Globe className="h-3 w-3" aria-hidden="true" />{a.website.replace(/^https?:\/\//, "")}
                          </a>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${a.name}`}>
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(a)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDeleteWithUndo(a.id, a.name)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data && data.total > data.limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>Showing {((page - 1) * data.limit) + 1}–{Math.min(page * data.limit, data.total)} of {data.total}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page * data.limit >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Account" : "New Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="accountName">Company Name <span className="text-destructive">*</span></Label>
              <Input
                id="accountName"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Acme Corp"
                aria-invalid={!!formErrors.name}
                aria-describedby={formErrors.name ? "name-error" : undefined}
                className={formErrors.name ? "border-destructive" : ""}
              />
              {formErrors.name && <p id="name-error" className="text-xs text-destructive">{formErrors.name}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="industry">Industry</Label>
                <Input id="industry" value={form.industry ?? ""} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="Technology" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="size">Size</Label>
                <Input id="size" value={form.size ?? ""} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} placeholder="1-50, 50-200..." />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={form.website ?? ""}
                onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                placeholder="https://example.com"
                aria-invalid={!!formErrors.website}
                aria-describedby={formErrors.website ? "website-error" : undefined}
                className={formErrors.website ? "border-destructive" : ""}
              />
              {formErrors.website && <p id="website-error" className="text-xs text-destructive">{formErrors.website}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={form.phone ?? ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="location">Location</Label>
                <Input id="location" value={form.location ?? ""} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>
            {canEditOwner && (
              <div className="space-y-1">
                <Label>Owner</Label>
                <Select
                  value={form.ownerId?.toString() ?? "unassigned"}
                  onValueChange={v => setForm(f => ({ ...f, ownerId: v === "unassigned" ? undefined : Number(v) }))}
                >
                  <SelectTrigger><SelectValue placeholder="Assign to..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {(usersData ?? []).map(u => (
                      <SelectItem key={u.id} value={u.id.toString()}>
                        {u.username ?? u.email?.split("@")[0] ?? `User ${u.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {serverError && (
            <p className="text-sm text-destructive px-1 -mb-2" role="alert">{serverError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleSave} disabled={createAccount.isPending || updateAccount.isPending}>
              {(createAccount.isPending || updateAccount.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {editTarget ? "Save Changes" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
