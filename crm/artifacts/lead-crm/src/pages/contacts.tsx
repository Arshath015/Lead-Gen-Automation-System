import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListContacts, useCreateContact, useUpdateContact, useDeleteContact,
  useListAccounts, getListContactsQueryKey,
  type Contact, type ContactInput,
} from "@workspace/api-client-react";
import { useListUsers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useUndoAction } from "@/hooks/use-undo-action";
import { format, parseISO } from "date-fns";
import { Plus, Search, MoreHorizontal, Loader2, Mail, Building2, UserRound, Trash2, FileSpreadsheet } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { usePermissions } from "@/hooks/use-permission";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EMPTY_FORM: ContactInput & { accountId?: number; ownerId?: number } = { firstName: "", lastName: "", email: "", phone: "", title: "" };

function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ContactCardSkeleton() {
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

export default function Contacts() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { execute: executeUndo } = useUndoAction();
  const { has } = usePermissions();
  const canEditOwner = has("contacts.edit");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactInput & { accountId?: number; ownerId?: number }>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Bulk select + undo-delete state ──────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useListContacts({ search: search || undefined, page, limit: 20 });
  const { data: accounts } = useListAccounts({ limit: 100 });
  const { data: usersData } = useListUsers();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });

  const contacts = data?.contacts ?? [];
  const visibleContacts = contacts.filter(c => !pendingDeleteIds.has(c.id));
  const isEmpty = !isLoading && visibleContacts.length === 0 && pendingDeleteIds.size === 0 && contacts.length === 0;

  // ── Row selection ──────────────────────────────────────────────────────────
  const toggleAll = (checked: boolean) => {
    if (checked) setSelectedIds(visibleContacts.map(c => c.id));
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
        await deleteContact.mutateAsync({ id });
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
      `${count} contact${count !== 1 ? "s" : ""} deleted.`,
      async () => {
        await fetch(`${BASE}/api/contacts/bulk-delete`, {
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

  // ── Export all filtered contacts to CSV ────────────────────────────────────
  const handleExportContacts = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ limit: "9999" });
      if (search) params.set("search", search);
      const resp = await fetch(`${BASE}/api/contacts?${params}`, {
        credentials: "include",
        headers: { "X-CSRF-Protection": "1" },
      });
      const json = await resp.json();
      const rows = (json.contacts ?? []) as any[];
      exportCsv(
        "contacts.csv",
        ["First Name", "Last Name", "Title", "Email", "Phone", "Account", "Added"],
        rows.map(c => [
          c.firstName,
          c.lastName ?? "",
          c.title ?? "",
          c.email ?? "",
          c.phone ?? "",
          c.accountName ?? "",
          c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-IN") : "",
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
  const openEdit = (c: Contact) => {
    setEditTarget(c);
    setFormErrors({});
    setServerError(null);
    setForm({ firstName: c.firstName, lastName: c.lastName ?? "", email: c.email ?? "", phone: c.phone ?? "", title: c.title ?? "", accountId: c.accountId ?? undefined, ownerId: (c as any).ownerId ?? undefined });
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.firstName?.trim()) errors.firstName = "First name is required";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = "Invalid email format";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    setServerError(null);
    if (!validateForm()) return;
    try {
      const payload: ContactInput & { accountId?: number } = { ...form };
      if (!payload.accountId) delete payload.accountId;
      if (editTarget) {
        await updateContact.mutateAsync({ id: editTarget.id, data: payload });
        toast({ title: "Contact updated" });
      } else {
        await createContact.mutateAsync({ data: payload });
        toast({ title: "Contact created" });
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
          <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground">Manage individual contacts and people.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportContacts} disabled={exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Export
          </Button>
          <Button variant="cta" onClick={openCreate}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />New Contact</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* ── Toolbar row: search + optional bulk bar ── */}
          <div className="flex items-center gap-2 p-4 border-b flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search contacts..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); setSelectedIds([]); }}
                aria-label="Search contacts"
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
                      <TableHead>Title</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Account</TableHead>
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
                        <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="md:hidden">
                {Array.from({ length: 5 }).map((_, i) => <ContactCardSkeleton key={i} />)}
              </div>
            </>
          )}

          {/* Empty state */}
          {isEmpty && (
            <Empty className="my-6 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><UserRound className="h-5 w-5" /></EmptyMedia>
                <EmptyTitle>No contacts yet</EmptyTitle>
                <EmptyDescription>
                  {search ? `No contacts match "${search}".` : "Add your first contact to start building relationships."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && (
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />New Contact
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          )}

          {/* Desktop Table */}
          {!isLoading && visibleContacts.length > 0 && (
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] px-4">
                      <Checkbox
                        checked={visibleContacts.length > 0 && selectedIds.length === visibleContacts.length}
                        onCheckedChange={toggleAll}
                        aria-label="Select all contacts"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleContacts.map(c => (
                    <TableRow key={c.id} className="group">
                      <TableCell className="px-4">
                        <Checkbox
                          checked={selectedIds.includes(c.id)}
                          onCheckedChange={(checked) => toggleOne(c.id, !!checked)}
                          aria-label={`Select ${c.firstName} ${c.lastName ?? ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">{c.firstName.charAt(0)}{c.lastName?.charAt(0) ?? ""}</AvatarFallback>
                          </Avatar>
                          <span className="font-semibold">{c.firstName} {c.lastName ?? ""}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.title ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {c.email ? <a href={`mailto:${c.email}`} className="text-primary hover:underline flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden="true" />{c.email}</a> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.phone ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {c.accountName ? <span className="flex items-center gap-1 text-muted-foreground"><Building2 className="h-3 w-3" aria-hidden="true" />{c.accountName}</span> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(parseISO(c.createdAt), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8" aria-label={`Actions for ${c.firstName} ${c.lastName ?? ""}`}>
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/contacts/${c.id}`)}>View</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(c)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDeleteWithUndo(c.id, `${c.firstName} ${c.lastName ?? ""}`.trim())}
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
          {!isLoading && visibleContacts.length > 0 && (
            <div className="md:hidden divide-y">
              {visibleContacts.map(c => (
                <div key={c.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className="text-sm bg-primary/10 text-primary">{c.firstName.charAt(0)}{c.lastName?.charAt(0) ?? ""}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <button
                          className="font-semibold text-sm text-left hover:text-primary transition-colors"
                          onClick={() => navigate(`/contacts/${c.id}`)}
                        >
                          {c.firstName} {c.lastName ?? ""}
                        </button>
                        {c.title && <p className="text-xs text-muted-foreground truncate">{c.title}</p>}
                        {c.accountName && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3 w-3" aria-hidden="true" />{c.accountName}
                          </p>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                            <Mail className="h-3 w-3" aria-hidden="true" />{c.email}
                          </a>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${c.firstName} ${c.lastName ?? ""}`}>
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/contacts/${c.id}`)}>View</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(c)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDeleteWithUndo(c.id, `${c.firstName} ${c.lastName ?? ""}`.trim())}
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
            <DialogTitle>{editTarget ? "Edit Contact" : "New Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                  placeholder="Jane"
                  aria-invalid={!!formErrors.firstName}
                  aria-describedby={formErrors.firstName ? "firstName-error" : undefined}
                  className={formErrors.firstName ? "border-destructive" : ""}
                />
                {formErrors.firstName && <p id="firstName-error" className="text-xs text-destructive">{formErrors.firstName}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={form.lastName ?? ""}
                  onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="title">Title / Position</Label>
              <Input
                id="title"
                value={form.title ?? ""}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="VP of Sales"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email ?? ""}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  aria-invalid={!!formErrors.email}
                  aria-describedby={formErrors.email ? "email-error" : undefined}
                  className={formErrors.email ? "border-destructive" : ""}
                />
                {formErrors.email && <p id="email-error" className="text-xs text-destructive">{formErrors.email}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone ?? ""}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
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
            {canEditOwner && (
              <div className="space-y-1">
                <Label>Owner</Label>
                <Select
                  value={(form as any).ownerId?.toString() ?? "unassigned"}
                  onValueChange={v => setForm(f => ({ ...f, ownerId: v === "unassigned" ? undefined : Number(v) } as any))}
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
            <Button variant="cta" onClick={handleSave} disabled={createContact.isPending || updateContact.isPending}>
              {(createContact.isPending || updateContact.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {editTarget ? "Save Changes" : "Create Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
