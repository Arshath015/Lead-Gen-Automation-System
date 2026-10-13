import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { useListUsers, useCreateUser, useDeleteUser, useUpdateUser, useListTeams, useListRoles } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, MoreHorizontal, User as UserIcon, Eye, EyeOff, Copy, Check, UserPlus, LogOut, Unlock, History, Shield } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format, parseISO } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-muted rounded-md px-3 py-2 text-sm font-mono break-all select-all">{value}</code>
        <Button type="button" variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={copy}>
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function Users() {
  const { data: users, isLoading, refetch } = useListUsers();
  const { data: teams } = useListTeams();
  const { data: roles } = useListRoles();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const { toast } = useToast();
  const { user: authUser } = useAuth();

  // Super Admin detection helpers
  const superAdminRoleId = (roles ?? []).find((r: any) => r.name === "Super Admin")?.id;
  const isUserSuperAdmin = (u: { isSuperAdmin?: boolean | null; roleId?: number | null } | null | undefined) =>
    !!(u?.isSuperAdmin) || (superAdminRoleId !== undefined && u?.roleId === superAdminRoleId);
  const amISuperAdmin = isUserSuperAdmin({ isSuperAdmin: (authUser as any)?.isSuperAdmin, roleId: (authUser as any)?.roleId });

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({ firstName: "", lastName: "", email: "", password: "", role: "bd" as "admin" | "manager" | "bd", phone: "", department: "" });
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createServerError, setCreateServerError] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Login history dialog
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyUser, setHistoryUser] = useState<{ id: number; name: string } | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Credentials dialog (shown after successful creation)
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsData, setCredsData] = useState<{ name: string; email: string; password: string; role: string } | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<{
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    isActive: boolean;
  } | null>(null);
  const [updateServerError, setUpdateServerError] = useState("");

  // Track which rows have pending quick-saves to show spinners
  const [quickSaving, setQuickSaving] = useState<Record<number, boolean>>({});

  const validateCreate = () => {
    const errors: Record<string, string> = {};
    if (!formData.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = "Invalid email format";
    if (!formData.password.trim()) errors.password = "Password is required";
    else if (formData.password.length < 8) errors.password = "Password must be at least 8 characters";
    setCreateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreate = async () => {
    setCreateServerError("");
    if (!validateCreate()) return;
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
        credentials: "include",
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create user");

      // Store credentials for sharing, then open the creds dialog
      const name = [formData.firstName, formData.lastName].filter(Boolean).join(" ") || formData.email;
      setCredsData({ name, email: formData.email, password: formData.password, role: formData.role });
      setCreateOpen(false);
      setCredsOpen(true);
      setCreateErrors({});
      setFormData({ firstName: "", lastName: "", email: "", password: "", role: "bd", phone: "", department: "" });
      refetch();
    } catch (e: any) {
      setCreateServerError(e.message ?? "An unexpected error occurred. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (user: {
    id: number;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    role: string;
    isActive?: boolean;
  }) => {
    setEditUser({
      id: user.id,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      email: user.email ?? "",
      role: user.role,
      isActive: user.isActive ?? true,
    });
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    setUpdateServerError("");
    if (!editUser) return;
    try {
      await updateUser.mutateAsync({
        id: editUser.id,
        data: {
          firstName: editUser.firstName || undefined,
          lastName: editUser.lastName || undefined,
          email: editUser.email || undefined,
          role: editUser.role as any,
          isActive: editUser.isActive,
        },
      });
      toast({ title: "User updated" });
      setEditOpen(false);
      setEditUser(null);
      setUpdateServerError("");
      refetch();
    } catch (e: any) {
      setUpdateServerError(e.message ?? "An unexpected error occurred. Please try again.");
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this user?")) {
      try {
        await deleteUser.mutateAsync({ id });
        toast({ title: "User deleted" });
        refetch();
      } catch (e: any) {
        toast({ title: "Failed to delete user", description: e.message, variant: "destructive" });
      }
    }
  };

  const quickUpdate = async (userId: number, data: Record<string, unknown>) => {
    setQuickSaving(prev => ({ ...prev, [userId]: true }));
    try {
      await updateUser.mutateAsync({ id: userId, data: data as any });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    } finally {
      setQuickSaving(prev => ({ ...prev, [userId]: false }));
    }
  };

  const managerCandidates = users?.filter(u => u.role === "admin" || u.role === "manager") ?? [];

  const userDisplayName = (u: { firstName?: string | null; lastName?: string | null; username: string }) =>
    u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username;

  const roleLabel: Record<string, string> = { admin: "Admin", manager: "Manager", bd: "Sales / BD" };

  const handleForceLogout = async (userId: number, name: string) => {
    if (!confirm(`Force log out ${name} from all active sessions and unlock their account?`)) return;
    try {
      const res = await fetch(`${BASE}/api/users/${userId}/force-logout`, { method: "POST", credentials: "include", headers: { "X-CSRF-Protection": "1" } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({ title: "Sessions cleared", description: `${name} has been logged out from all devices.` });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const handleUnlock = async (userId: number, name: string) => {
    try {
      const res = await fetch(`${BASE}/api/users/${userId}/unlock`, { method: "POST", credentials: "include", headers: { "X-CSRF-Protection": "1" } });
      if (!res.ok) throw new Error("Failed to unlock");
      toast({ title: "Account unlocked", description: `${name}'s account has been unlocked.` });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const handleViewHistory = async (userId: number, name: string) => {
    setHistoryUser({ id: userId, name });
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${BASE}/api/users/${userId}/login-history`, { credentials: "include" });
      const data = await res.json();
      setHistoryData(Array.isArray(data) ? data : []);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Members</h1>
          <p className="text-muted-foreground">Manage access, roles, teams, and managers for your team.</p>
        </div>
        <Button variant="cta" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Member
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-6">Member</TableHead>
                  <TableHead className="min-w-[130px]">Access Level</TableHead>
                  <TableHead className="min-w-[150px]">Custom Role</TableHead>
                  <TableHead className="min-w-[150px]">Team</TableHead>
                  <TableHead className="min-w-[160px]">Manager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : users?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      No team members found.
                    </TableCell>
                  </TableRow>
                ) : (
                  users?.map((user) => {
                    const isTargetSA = isUserSuperAdmin({ isSuperAdmin: (user as any).isSuperAdmin, roleId: user.roleId });
                    const isProtected = isTargetSA && !amISuperAdmin;
                    return (
                    <TableRow key={user.id}>
                      <TableCell className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          {quickSaving[user.id] ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
                          ) : (
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarImage src={user.profileImage || ""} />
                              <AvatarFallback><UserIcon className="h-4 w-4" /></AvatarFallback>
                            </Avatar>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-foreground text-sm">{user.username}</p>
                              {isTargetSA && (
                                <span title="Super Admin — protected account"><Shield className="h-3.5 w-3.5 text-amber-500" /></span>
                              )}
                              {(user as any).lockedUntil && new Date((user as any).lockedUntil) > new Date() && (
                                <Badge variant="outline" className="text-[10px] py-0 px-1 text-destructive border-destructive/40">Locked</Badge>
                              )}
                            </div>
                            {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                            {(user as any).lastLoginAt && (
                              <p className="text-[10px] text-muted-foreground/70">Last login: {format(parseISO((user as any).lastLoginAt), "MMM d, HH:mm")}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      {/* Inline Role dropdown */}
                      <TableCell className="py-2">
                        <Select
                          value={user.role}
                          onValueChange={(v) => quickUpdate(user.id, { role: v })}
                          disabled={isProtected}
                        >
                          <SelectTrigger className="h-8 text-xs w-[120px]" title={isProtected ? "Super Admin accounts can only be modified by another Super Admin" : undefined}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bd">Sales / BD</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* Inline Custom Role dropdown */}
                      <TableCell className="py-2">
                        <Select
                          value={user.roleId ? String(user.roleId) : "none"}
                          onValueChange={(v) => quickUpdate(user.id, { roleId: v === "none" ? null : Number(v) })}
                          disabled={isProtected}
                        >
                          <SelectTrigger className="h-8 text-xs w-[140px]" title={isProtected ? "Super Admin accounts can only be modified by another Super Admin" : undefined}><SelectValue placeholder="No custom role" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none"><span className="text-muted-foreground">No custom role</span></SelectItem>
                            {(roles ?? []).map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* Inline Team dropdown */}
                      <TableCell className="py-2">
                        <Select
                          value={user.teamId ? String(user.teamId) : "none"}
                          onValueChange={(v) => quickUpdate(user.id, { teamId: v === "none" ? null : Number(v) })}
                          disabled={isProtected}
                        >
                          <SelectTrigger className="h-8 text-xs w-[140px]" title={isProtected ? "Super Admin accounts can only be modified by another Super Admin" : undefined}><SelectValue placeholder="No team" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none"><span className="text-muted-foreground">No team</span></SelectItem>
                            {(teams ?? []).map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* Inline Manager dropdown */}
                      <TableCell className="py-2">
                        <Select
                          value={user.managerId ? String(user.managerId) : "none"}
                          onValueChange={(v) => quickUpdate(user.id, { managerId: v === "none" ? null : Number(v) })}
                          disabled={isProtected}
                        >
                          <SelectTrigger className="h-8 text-xs w-[150px]" title={isProtected ? "Super Admin accounts can only be modified by another Super Admin" : undefined}><SelectValue placeholder="No manager" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none"><span className="text-muted-foreground">No manager</span></SelectItem>
                            {managerCandidates.filter(u => u.id !== user.id).map(u => (
                              <SelectItem key={u.id} value={String(u.id)}>{userDisplayName(u)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>

                      <TableCell>
                        {user.isActive ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(parseISO(user.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!isProtected && (
                              <DropdownMenuItem onClick={() => openEdit(user)}>Edit Details</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleViewHistory(user.id, userDisplayName(user))}>
                              <History className="h-4 w-4 mr-2" />Login History
                            </DropdownMenuItem>
                            {!isProtected && (user as any).lockedUntil && new Date((user as any).lockedUntil) > new Date() && (
                              <DropdownMenuItem onClick={() => handleUnlock(user.id, userDisplayName(user))}>
                                <Unlock className="h-4 w-4 mr-2" />Unlock Account
                              </DropdownMenuItem>
                            )}
                            {!isProtected && (
                              <DropdownMenuItem onClick={() => handleForceLogout(user.id, userDisplayName(user))}>
                                <LogOut className="h-4 w-4 mr-2" />Force Logout
                              </DropdownMenuItem>
                            )}
                            {!isProtected && (
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(user.id)}>Delete User</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Create User Dialog ── */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) { setCreateErrors({}); setCreateServerError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Create a login account for a new team member. The account will be active immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="createFirst">First name</Label>
                <Input id="createFirst" value={formData.firstName} onChange={(e) => setFormData({...formData, firstName: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="createLast">Last name</Label>
                <Input id="createLast" value={formData.lastName} onChange={(e) => setFormData({...formData, lastName: e.target.value})} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="createEmail">Email <span className="text-destructive">*</span></Label>
              <Input
                id="createEmail"
                type="email"
                autoComplete="off"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                aria-invalid={!!createErrors.email}
                className={createErrors.email ? "border-destructive" : ""}
              />
              {createErrors.email && <p className="text-xs text-destructive">{createErrors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="createPassword">Initial password <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input
                  id="createPassword"
                  type={showNewPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  aria-invalid={!!createErrors.password}
                  className={createErrors.password ? "border-destructive" : ""}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  tabIndex={-1}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {createErrors.password
                ? <p className="text-xs text-destructive">{createErrors.password}</p>
                : <p className="text-xs text-muted-foreground">At least 8 characters.</p>
              }
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={formData.role} onValueChange={(v: "admin" | "manager" | "bd") => setFormData({...formData, role: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bd">Sales / BD</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="createPhone">Phone</Label>
                <Input id="createPhone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} placeholder="+1 555 0000" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="createDept">Department</Label>
                <Input id="createDept" value={formData.department} onChange={(e) => setFormData({...formData, department: e.target.value})} placeholder="Sales, Marketing…" />
              </div>
            </div>
          </div>
          {createServerError && <p className="text-sm text-destructive px-1 -mb-2" role="alert">{createServerError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              {creating ? "Creating…" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Credentials Card (shown after creation) ── */}
      <Dialog open={credsOpen} onOpenChange={setCredsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              Account created
            </DialogTitle>
            <DialogDescription>
              Share these login details with <strong>{credsData?.name}</strong>. The password is only shown once — copy it now.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs">{roleLabel[credsData?.role ?? "bd"] ?? credsData?.role}</Badge>
                <span className="text-xs text-muted-foreground">— active immediately</span>
              </div>
              {credsData && (
                <>
                  <CopyField label="Login URL" value={`${window.location.origin}${BASE}/login`} />
                  <CopyField label="Email" value={credsData.email} />
                  <CopyField label="Password" value={credsData.password} />
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The user can change their password anytime from Settings after logging in.
            </p>
          </div>

          <DialogFooter>
            <Button variant="cta" onClick={() => setCredsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Details Dialog ── */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setUpdateServerError(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Member Details</DialogTitle>
            <DialogDescription>
              Update name, email, and active status. Use the table dropdowns to change role, team, and manager.
            </DialogDescription>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="editFirstName">First Name</Label>
                  <Input id="editFirstName" value={editUser.firstName} onChange={(e) => setEditUser({ ...editUser, firstName: e.target.value })} placeholder="Jane" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editLastName">Last Name</Label>
                  <Input id="editLastName" value={editUser.lastName} onChange={(e) => setEditUser({ ...editUser, lastName: e.target.value })} placeholder="Smith" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEmail">Email (optional)</Label>
                <Input id="editEmail" type="email" value={editUser.email} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={editUser.isActive}
                  onChange={(e) => setEditUser({ ...editUser, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <Label htmlFor="isActive" className="cursor-pointer font-normal">Active account</Label>
              </div>
            </div>
          )}
          {updateServerError && <p className="text-sm text-destructive px-1 -mb-2" role="alert">{updateServerError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="cta" onClick={handleUpdate} disabled={updateUser.isPending}>
              {updateUser.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Login History Dialog ── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Login History — {historyUser?.name}
            </DialogTitle>
            <DialogDescription>Last 50 login attempts for this user</DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : historyData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No login history found.</p>
          ) : (
            <div className="space-y-1">
              {historyData.map((h: any) => (
                <div key={h.id} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${h.success ? "bg-green-50 dark:bg-green-950/30" : "bg-destructive/5"}`}>
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${h.success ? "bg-green-500" : "bg-destructive"}`} />
                  <span className="flex-1">
                    <span className={h.success ? "text-green-700 dark:text-green-400 font-medium" : "text-destructive font-medium"}>
                      {h.success ? "Success" : "Failed"}
                    </span>
                    {h.failureReason && <span className="text-muted-foreground ml-2">({h.failureReason.replace(/_/g, " ")})</span>}
                  </span>
                  <span className="text-muted-foreground text-xs">{h.ipAddress ?? "—"}</span>
                  <span className="text-muted-foreground text-xs whitespace-nowrap">{format(parseISO(h.createdAt), "MMM d, yyyy HH:mm")}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
