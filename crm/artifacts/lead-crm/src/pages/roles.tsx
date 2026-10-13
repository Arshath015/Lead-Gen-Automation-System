import { useState, useEffect } from "react";
import {
  useListRoles, useCreateRole, useUpdateRole, useDeleteRole,
  useSetRolePermissions, useSetRoleWidgets, useDuplicateRole,
  useGetRoleMembers,
  useListTeams, useCreateTeam, useUpdateTeam, useDeleteTeam,
  useAddTeamMember, useRemoveTeamMember,
  useListUsers,
  useGetUserPermissionOverrides, useSetUserPermissionOverrides,
} from "@workspace/api-client-react";
import type { Role, Team } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Pencil, Trash2, Shield, Users as UsersIcon, Copy, Lock, UserCheck, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Can } from "@/components/can";
import { usePermissions } from "@/hooks/use-permission";

// ── Full Permission Matrix (mirrors lib/db/src/permissions.ts) ────────────────

const MODULES = [
  { key: "leads",          label: "Leads" },
  { key: "pipeline",       label: "Pipeline" },
  { key: "contacts",       label: "Contacts" },
  { key: "deals",          label: "Deals" },
  { key: "tasks",          label: "Tasks" },
  { key: "activities",     label: "Activities" },
  { key: "followups",      label: "Follow-ups" },
  { key: "reports",        label: "Reports" },
  { key: "dashboard",      label: "Dashboard" },
  { key: "users",          label: "Users" },
  { key: "roles",          label: "Roles" },
  { key: "settings",       label: "Settings" },
  { key: "smtp",           label: "SMTP" },
  { key: "whatsapp",       label: "WhatsApp" },
  { key: "automation",     label: "Automation" },
  { key: "forms",          label: "Forms" },
  { key: "files",          label: "Files" },
  { key: "notifications",  label: "Notifications" },
  { key: "email_templates", label: "Email Templates" },
  { key: "audit",          label: "Audit Log" },
  { key: "billing",        label: "Billing" },
  { key: "integrations",   label: "Integrations" },
  { key: "approvals",      label: "Approvals" },
] as const;

const MODULE_ACTIONS: Record<string, readonly string[]> = {
  leads:           ["view", "create", "edit", "delete", "assign", "import", "export"],
  pipeline:        ["view", "edit", "move_stage", "assign"],
  contacts:        ["view", "create", "edit", "delete", "import", "export"],
  deals:           ["view", "create", "edit", "delete"],
  tasks:           ["view", "create", "edit", "delete", "assign"],
  activities:      ["view", "create", "edit", "delete"],
  followups:       ["view", "create", "edit", "delete"],
  reports:         ["view", "export"],
  dashboard:       ["view", "customize"],
  users:           ["view", "create", "edit", "disable", "delete", "force_logout", "unlock_account"],
  roles:           ["view", "create", "edit", "delete"],
  settings:        ["view", "edit"],
  smtp:            ["view", "edit"],
  whatsapp:        ["view", "edit"],
  automation:      ["view", "create", "edit", "delete"],
  forms:           ["view", "create", "edit", "delete"],
  files:           ["upload", "download", "delete"],
  notifications:   ["view", "send"],
  email_templates: ["view", "edit"],
  audit:           ["view"],
  billing:         ["view", "manage"],
  integrations:    ["view", "manage"],
  approvals:       ["view", "approve", "reject"],
};

const ACTION_LABELS: Record<string, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete",
  assign: "Assign", import: "Import", export: "Export",
  move_stage: "Move Stage", customize: "Customize",
  disable: "Disable", force_logout: "Force Logout", unlock_account: "Unlock",
  send: "Send", manage: "Manage", upload: "Upload", download: "Download",
  approve: "Approve", reject: "Reject",
};

const NAV_WIDGETS = [
  { key: "nav_dashboard", label: "Dashboard" },
  { key: "nav_leads", label: "Leads" },
  { key: "nav_activities", label: "Activities" },
  { key: "nav_reports", label: "Reports" },
  { key: "nav_users", label: "Team" },
  { key: "nav_audit", label: "Audit Log" },
  { key: "nav_settings", label: "Settings" },
];

const DASHBOARD_WIDGETS = [
  { key: "widget_stats_bar", label: "Stats Bar" },
  { key: "widget_stage_chart", label: "Pipeline Stage Chart" },
  { key: "widget_funnel", label: "Conversion Funnel" },
  { key: "widget_recent_activity", label: "Recent Activity" },
];

const SCOPE_LABELS: Record<string, string> = { all: "All Data", team: "Team Data", own: "Own Data" };

// ── Permission Map helpers ────────────────────────────────────────────────────

type PermMap = Record<string, Record<string, boolean>>;

function buildPermMap(permissions: Array<{ module: string; action: string; allowed: boolean }>): PermMap {
  const map: PermMap = {};
  for (const m of MODULES) {
    map[m.key] = {};
    for (const a of MODULE_ACTIONS[m.key] ?? []) map[m.key][a] = false;
  }
  for (const p of permissions) {
    if (map[p.module]?.[p.action] !== undefined) map[p.module][p.action] = p.allowed;
  }
  return map;
}

function permMapToArray(map: PermMap) {
  const arr: Array<{ module: string; action: string; allowed: boolean }> = [];
  for (const m of MODULES) {
    for (const a of MODULE_ACTIONS[m.key] ?? []) {
      arr.push({ module: m.key, action: a, allowed: map[m.key]?.[a] ?? false });
    }
  }
  return arr;
}

type WidgetMap = Record<string, boolean>;

function buildWidgetMap(widgets: Array<{ widgetKey: string; visible: boolean }>): WidgetMap {
  const map: WidgetMap = {};
  for (const w of [...NAV_WIDGETS, ...DASHBOARD_WIDGETS]) map[w.key] = true;
  for (const w of widgets) map[w.widgetKey] = w.visible;
  return map;
}

function widgetMapToArray(map: WidgetMap) {
  return Object.entries(map).map(([widgetKey, visible]) => ({ widgetKey, visible }));
}

// ── Permission Matrix Component ───────────────────────────────────────────────

function PermissionMatrixEditor({
  permMap,
  readOnly,
  onToggle,
  onSelectAll,
}: {
  permMap: PermMap;
  readOnly: boolean;
  onToggle: (mod: string, act: string) => void;
  onSelectAll?: (select: boolean) => void;
}) {
  const totalCount = Object.values(permMap).flatMap(m => Object.values(m)).length;
  const grantedCount = Object.values(permMap).flatMap(m => Object.values(m)).filter(Boolean).length;
  const allSelected = totalCount > 0 && grantedCount === totalCount;
  const someSelected = grantedCount > 0 && grantedCount < totalCount;

  const toggleAllModule = (mod: string) => {
    if (readOnly) return;
    const actions = MODULE_ACTIONS[mod] ?? [];
    const anyTrue = actions.some(a => permMap[mod]?.[a]);
    for (const a of actions) onToggle(mod, anyTrue ? (permMap[mod]?.[a] ? a : "__skip__") : (!permMap[mod]?.[a] ? a : "__skip__"));
  };

  return (
    <div className="space-y-2">
      {!readOnly && onSelectAll && (
        <div className="flex items-center gap-2.5 px-3 py-2 border rounded-lg bg-muted/20">
          <input
            type="checkbox"
            id="select-all-perms"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onChange={(e) => onSelectAll(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary shrink-0"
          />
          <label htmlFor="select-all-perms" className="text-sm font-medium cursor-pointer select-none flex-1">
            Select All Permissions
          </label>
          <span className="text-xs text-muted-foreground shrink-0">
            {grantedCount} / {totalCount} selected
          </span>
        </div>
      )}
      <div className="space-y-1 max-h-[380px] overflow-y-auto pr-1">
      {MODULES.map(m => {
        const actions = MODULE_ACTIONS[m.key] ?? [];
        const grantedCount = actions.filter(a => permMap[m.key]?.[a]).length;
        return (
          <div key={m.key} className="border rounded-lg px-3 py-2.5 hover:bg-muted/20 transition-colors">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                className="text-sm font-medium w-36 text-left shrink-0 hover:text-primary disabled:cursor-default disabled:hover:text-foreground transition-colors"
                onClick={() => !readOnly && toggleAllModule(m.key)}
                disabled={readOnly}
                title={readOnly ? undefined : `Toggle all ${m.label} permissions`}
              >
                {m.label}
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                  {grantedCount}/{actions.length}
                </span>
              </button>
              <div className="flex flex-wrap gap-1.5">
                {actions.map(a => {
                  const checked = permMap[m.key]?.[a] ?? false;
                  return (
                    <label
                      key={a}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-colors select-none
                        ${checked
                          ? "bg-primary/10 text-primary border border-primary/30"
                          : "bg-muted/50 text-muted-foreground border border-transparent hover:border-muted-foreground/30"
                        } ${readOnly ? "cursor-not-allowed opacity-70" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => !readOnly && onToggle(m.key, a)}
                        disabled={readOnly}
                      />
                      {ACTION_LABELS[a] ?? a}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ── Members Tab ───────────────────────────────────────────────────────────────

function RoleMembersTab({ roleId }: { roleId: number }) {
  const { data, isLoading } = useGetRoleMembers(roleId);
  const members = (data as any)?.members ?? data ?? [];

  if (isLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!members.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <UsersIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No users assigned to this role yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">{members.length} user{members.length !== 1 ? "s" : ""} assigned to this role.</p>
      <div className="divide-y border rounded-lg overflow-hidden">
        {members.map((u: any) => (
          <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-primary">
                {(u.firstName?.[0] ?? u.username?.[0] ?? "?").toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username}
              </p>
              <p className="text-xs text-muted-foreground truncate">{u.email ?? ""}</p>
            </div>
            <Badge variant="secondary" className="capitalize text-xs shrink-0">
              {{ admin: "Admin", manager: "Manager", bd: "BD" }[u.role as string] ?? u.role}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Role Editor Dialog ────────────────────────────────────────────────────────

function RoleEditorDialog({
  role,
  open,
  onClose,
  onSaved,
}: {
  role: Role | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isNew = !role;

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [dataScope, setDataScope] = useState<"all" | "team" | "own">(role?.dataScope ?? "own");
  const [permMap, setPermMap] = useState<PermMap>(() => buildPermMap(role?.permissions ?? []));
  const [widgetMap, setWidgetMap] = useState<WidgetMap>(() => buildWidgetMap(role?.widgets ?? []));
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [serverError, setServerError] = useState("");

  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const setRolePermissions = useSetRolePermissions();
  const setRoleWidgets = useSetRoleWidgets();

  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setDescription(role?.description ?? "");
      setDataScope(role?.dataScope ?? "own");
      setPermMap(buildPermMap(role?.permissions ?? []));
      setWidgetMap(buildWidgetMap(role?.widgets ?? []));
      setSaving(false);
      setNameError("");
      setServerError("");
    }
  }, [open, role?.id]);

  if (!open) return null;

  const handleSave = async () => {
    setServerError("");
    if (!name.trim()) { setNameError("Role name is required"); return; }
    setNameError("");
    setSaving(true);
    try {
      let savedId = role?.id;
      if (isNew) {
        const created = await createRole.mutateAsync({ data: { name: name.trim(), description: description || undefined, dataScope } });
        savedId = created.id;
      } else if (!role?.isSystem) {
        // System roles: name/description/dataScope are locked — skip PATCH to avoid 400
        await updateRole.mutateAsync({ id: role!.id, data: { name: name.trim(), description: description || undefined, dataScope } });
      }
      if (savedId) {
        await setRolePermissions.mutateAsync({ id: savedId, data: { permissions: permMapToArray(permMap) } });
        await setRoleWidgets.mutateAsync({ id: savedId, data: { widgets: widgetMapToArray(widgetMap) } });
      }
      toast({ title: isNew ? "Role created" : "Role updated" });
      onSaved();
      onClose();
    } catch (e: any) {
      setServerError(e.message ?? "An unexpected error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (mod: string, act: string) => {
    if (act === "__skip__") return;
    setPermMap(prev => ({ ...prev, [mod]: { ...prev[mod], [act]: !prev[mod][act] } }));
  };

  const handleSelectAll = (select: boolean) => {
    setPermMap(() => {
      const next: PermMap = {};
      for (const m of MODULES) {
        next[m.key] = {};
        for (const a of MODULE_ACTIONS[m.key] ?? []) next[m.key][a] = select;
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {role?.isSystem && <Lock className="h-4 w-4 text-muted-foreground" />}
            {isNew ? "New Role" : `Edit Role: ${role?.name}`}
          </DialogTitle>
          {role?.isSystem && (
            <DialogDescription>System roles cannot be renamed or have their data scope changed. Permissions and widget visibility can still be adjusted.</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <Tabs defaultValue="permissions">
            <TabsList className="mb-4">
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="widgets">Widgets</TabsTrigger>
              {!isNew && <TabsTrigger value="members">Members {role?.memberCount ? `(${role.memberCount})` : ""}</TabsTrigger>}
            </TabsList>

            <TabsContent value="permissions" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="roleName">Role Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="roleName"
                    value={name}
                    onChange={e => { setName(e.target.value); if (nameError) setNameError(""); }}
                    disabled={role?.isSystem}
                    placeholder="e.g. Sales Lead"
                    aria-invalid={!!nameError}
                    className={nameError ? "border-destructive" : ""}
                  />
                  {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Data Scope</Label>
                  <Select value={dataScope} onValueChange={(v: any) => setDataScope(v)} disabled={role?.isSystem}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Data (see everything)</SelectItem>
                      <SelectItem value="team">Team Data (see team's data)</SelectItem>
                      <SelectItem value="own">Own Data (see own data only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={role?.isSystem}
                  placeholder="Describe what this role can do..."
                  rows={2}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Permission Matrix</Label>
                  <span className="text-xs text-muted-foreground">
                    {Object.values(permMap).flatMap(m => Object.values(m)).filter(Boolean).length} permissions granted
                  </span>
                </div>
                {role?.isSystem && (
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Role name and data scope are locked. Permissions below can be freely adjusted.
                  </p>
                )}
                <PermissionMatrixEditor
                  permMap={permMap}
                  readOnly={false}
                  onToggle={handleToggle}
                  onSelectAll={handleSelectAll}
                />
                <p className="text-xs text-muted-foreground mt-1.5">Click a module name to toggle all its permissions at once.</p>
              </div>
            </TabsContent>

            <TabsContent value="widgets" className="mt-0 space-y-5">
              <div>
                <h4 className="font-medium mb-3">Navigation Items</h4>
                <div className="space-y-2">
                  {NAV_WIDGETS.map(w => (
                    <div key={w.key} className="flex items-center justify-between py-2 px-3 border rounded-md">
                      <span className="text-sm font-medium">{w.label}</span>
                      <Switch
                        checked={widgetMap[w.key] ?? true}
                        onCheckedChange={v => setWidgetMap(prev => ({ ...prev, [w.key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="font-medium mb-3">Dashboard Widgets</h4>
                <div className="space-y-2">
                  {DASHBOARD_WIDGETS.map(w => (
                    <div key={w.key} className="flex items-center justify-between py-2 px-3 border rounded-md">
                      <span className="text-sm font-medium">{w.label}</span>
                      <Switch
                        checked={widgetMap[w.key] ?? true}
                        onCheckedChange={v => setWidgetMap(prev => ({ ...prev, [w.key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {!isNew && (
              <TabsContent value="members" className="mt-0">
                <RoleMembersTab roleId={role!.id} />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {serverError && (
          <p className="text-sm text-destructive px-1" role="alert">{serverError}</p>
        )}
        <DialogFooter className="pt-4 border-t shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="cta" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isNew ? "Create Role" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Team Editor Dialog ────────────────────────────────────────────────────────

function TeamEditorDialog({
  team,
  open,
  onClose,
  onSaved,
}: {
  team: Team | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { data: users } = useListUsers();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();

  const isNew = !team;
  const [name, setName] = useState(team?.name ?? "");
  const [managerId, setManagerId] = useState<string>(team?.managerId ? String(team.managerId) : "");
  const [memberIds, setMemberIds] = useState<number[]>(team?.memberIds ?? []);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (open) {
      setName(team?.name ?? "");
      setManagerId(team?.managerId ? String(team.managerId) : "");
      setMemberIds(team?.memberIds ?? []);
      setSaving(false);
      setNameError("");
      setServerError("");
    }
  }, [open, team?.id]);

  if (!open) return null;

  const managerCandidates = users?.filter(u => u.role === "admin" || u.role === "manager") ?? [];
  const nonManagerUsers = users ?? [];

  const handleSave = async () => {
    setServerError("");
    if (!name.trim()) { setNameError("Team name is required"); return; }
    setNameError("");
    setSaving(true);
    try {
      const mgr = managerId ? Number(managerId) : undefined;
      let savedTeam: Team;
      if (isNew) {
        savedTeam = await createTeam.mutateAsync({ data: { name: name.trim(), managerId: mgr } });
      } else {
        savedTeam = await updateTeam.mutateAsync({ id: team!.id, data: { name: name.trim(), managerId: mgr } });
      }
      if (!isNew) {
        const current = team!.memberIds ?? [];
        const toAdd = memberIds.filter(id => !current.includes(id));
        const toRemove = current.filter(id => !memberIds.includes(id));
        await Promise.all([
          ...toAdd.map(uid => addMember.mutateAsync({ id: savedTeam.id, data: { userId: uid } })),
          ...toRemove.map(uid => removeMember.mutateAsync({ id: savedTeam.id, userId: uid })),
        ]);
      } else {
        await Promise.all(memberIds.map(uid => addMember.mutateAsync({ id: savedTeam.id, data: { userId: uid } })));
      }
      toast({ title: isNew ? "Team created" : "Team updated" });
      onSaved();
      onClose();
    } catch (e: any) {
      setServerError(e.message ?? "An unexpected error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleMember = (uid: number) => {
    setMemberIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "New Team" : `Edit Team: ${team?.name}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="teamName">Team Name <span className="text-destructive">*</span></Label>
            <Input
              id="teamName"
              value={name}
              onChange={e => { setName(e.target.value); if (nameError) setNameError(""); }}
              placeholder="e.g. North Sales Team"
              aria-invalid={!!nameError}
              className={nameError ? "border-destructive" : ""}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="space-y-2">
            <Label>Manager</Label>
            <Select value={managerId || "none"} onValueChange={v => setManagerId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="No manager assigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No manager</SelectItem>
                {managerCandidates.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username}
                    <span className="ml-2 text-xs text-muted-foreground capitalize">({u.role})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Members <span className="text-muted-foreground text-xs">({memberIds.length} selected)</span></Label>
            <div className="border rounded-lg max-h-52 overflow-y-auto divide-y">
              {nonManagerUsers.length === 0 && (
                <p className="text-sm text-muted-foreground p-3">No users found.</p>
              )}
              {nonManagerUsers.map(u => (
                <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(u.id)}
                    onChange={() => toggleMember(u.id)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm font-medium flex-1">
                    {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username}
                  </span>
                  <Badge variant="secondary" className="capitalize text-xs">
                    {({ admin: "Admin", manager: "Manager", bd: "BD" } as Record<string, string>)[u.role] ?? u.role}
                  </Badge>
                </label>
              ))}
            </div>
          </div>
        </div>
        {serverError && (
          <p className="text-sm text-destructive px-1" role="alert">{serverError}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="cta" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isNew ? "Create Team" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── User Permission Overrides Panel ───────────────────────────────────────────

function UserPermissionOverridesPanel() {
  const { toast } = useToast();
  const { data: users } = useListUsers();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data: overridesData, isLoading, refetch } = useGetUserPermissionOverrides(
    selectedUserId ?? 0
  );
  const setOverrides = useSetUserPermissionOverrides();

  const overrides: Array<{ module: string; action: string; allowed: boolean }> = (overridesData as any) ?? [];

  const [localOverrides, setLocalOverrides] = useState<typeof overrides>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalOverrides(overrides);
  }, [overridesData]);

  const getOverride = (mod: string, act: string) =>
    localOverrides.find(o => o.module === mod && o.action === act);

  const toggleOverride = (mod: string, act: string) => {
    const existing = getOverride(mod, act);
    if (!existing) {
      setLocalOverrides(prev => [...prev, { module: mod, action: act, allowed: true }]);
    } else if (existing.allowed) {
      setLocalOverrides(prev => prev.map(o =>
        o.module === mod && o.action === act ? { ...o, allowed: false } : o
      ));
    } else {
      setLocalOverrides(prev => prev.filter(o => !(o.module === mod && o.action === act)));
    }
  };

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await setOverrides.mutateAsync({ userId: selectedUserId, data: { overrides: localOverrides } });
      toast({ title: "Permission overrides saved" });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleClearAll = () => setLocalOverrides([]);

  return (
    <div className="space-y-5">
      <div>
        <Label className="mb-2 block">Select User</Label>
        <Select
          value={selectedUserId ? String(selectedUserId) : ""}
          onValueChange={v => { setSelectedUserId(v ? Number(v) : null); setLocalOverrides([]); }}
        >
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="Choose a user to override permissions..." />
          </SelectTrigger>
          <SelectContent>
            {(users ?? []).map(u => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username}
                <span className="ml-2 text-xs text-muted-foreground capitalize">({u.role})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1.5">
          Overrides grant or deny specific permissions for a single user, on top of their role's defaults.
        </p>
      </div>

      {selectedUserId && (
        <>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading overrides…</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Permission Overrides</span>
                  {localOverrides.length > 0 && (
                    <Badge variant="secondary">{localOverrides.length} override{localOverrides.length !== 1 ? "s" : ""}</Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={handleClearAll} disabled={localOverrides.length === 0}>
                  Clear all
                </Button>
              </div>

              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Click once to <strong>grant</strong> (green), click again to <strong>deny</strong> (red), click again to <strong>clear</strong> the override.</span>
              </div>

              <div className="space-y-1">
                {MODULES.map(m => {
                  const actions = MODULE_ACTIONS[m.key] ?? [];
                  return (
                    <div key={m.key} className="border rounded-lg px-3 py-2.5 hover:bg-muted/20">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-medium w-36 shrink-0">{m.label}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {actions.map(a => {
                            const ov = getOverride(m.key, a);
                            const state = ov === undefined ? "none" : ov.allowed ? "grant" : "deny";
                            return (
                              <button
                                key={a}
                                onClick={() => toggleOverride(m.key, a)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors select-none border
                                  ${state === "grant" ? "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700"
                                  : state === "deny" ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700"
                                  : "bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/30"
                                }`}
                                title={state === "none" ? `Click to grant ${m.label}.${a}` : state === "grant" ? `Click to deny ${m.label}.${a}` : `Click to clear override`}
                              >
                                {state === "grant" && "✓ "}
                                {state === "deny" && "✗ "}
                                {ACTION_LABELS[a] ?? a}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-2 border-t">
                <Button variant="cta" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Overrides
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RolesPage() {
  const { toast } = useToast();
  const { has } = usePermissions();
  const { data: roles, isLoading: rolesLoading, refetch: refetchRoles } = useListRoles();
  const { data: teams, isLoading: teamsLoading, refetch: refetchTeams } = useListTeams();
  const { data: users } = useListUsers();
  const deleteRole = useDeleteRole();
  const deleteTeam = useDeleteTeam();
  const duplicateRole = useDuplicateRole();

  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [teamEditorOpen, setTeamEditorOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<number | null>(null);
  const [deleteTeamId, setDeleteTeamId] = useState<number | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);

  const openNewRole = () => { setEditingRole(null); setRoleEditorOpen(true); };
  const openEditRole = (r: Role) => { setEditingRole(r); setRoleEditorOpen(true); };
  const openNewTeam = () => { setEditingTeam(null); setTeamEditorOpen(true); };
  const openEditTeam = (t: Team) => { setEditingTeam(t); setTeamEditorOpen(true); };

  const handleDeleteRole = async () => {
    if (!deleteRoleId) return;
    try {
      await deleteRole.mutateAsync({ id: deleteRoleId });
      toast({ title: "Role deleted" });
      refetchRoles();
    } catch (e: any) {
      toast({ title: "Error deleting role", description: e.message, variant: "destructive" });
    } finally {
      setDeleteRoleId(null);
    }
  };

  const handleDeleteTeam = async () => {
    if (!deleteTeamId) return;
    try {
      await deleteTeam.mutateAsync({ id: deleteTeamId });
      toast({ title: "Team deleted" });
      refetchTeams();
    } catch (e: any) {
      toast({ title: "Error deleting team", description: e.message, variant: "destructive" });
    } finally {
      setDeleteTeamId(null);
    }
  };

  const handleDuplicateRole = async (roleId: number) => {
    setDuplicatingId(roleId);
    try {
      await duplicateRole.mutateAsync({ id: roleId });
      toast({ title: "Role duplicated" });
      refetchRoles();
    } catch (e: any) {
      toast({ title: "Error duplicating role", description: e.message, variant: "destructive" });
    } finally {
      setDuplicatingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles & Access</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage permission roles, teams, and per-user overrides.</p>
        </div>
      </div>

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles" className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Roles
          </TabsTrigger>
          <TabsTrigger value="teams" className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4" /> Teams
          </TabsTrigger>
          <Can permission="roles.edit">
            <TabsTrigger value="overrides" className="flex items-center gap-2">
              <UserCheck className="h-4 w-4" /> User Overrides
            </TabsTrigger>
          </Can>
        </TabsList>

        {/* ── Roles Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="roles" className="mt-5">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Permission Roles
                </CardTitle>
                <Can permission="roles.create">
                  <Button size="sm" variant="cta" onClick={openNewRole}>
                    <Plus className="h-4 w-4 mr-1.5" /> New Role
                  </Button>
                </Can>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {rolesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !roles?.length ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No roles found.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Data Scope</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-center">Members</TableHead>
                      <TableHead className="text-center">Permissions</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roles.map(role => (
                      <TableRow key={role.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {role.isSystem && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                            <div>
                              <p className="font-medium text-sm">{role.name}</p>
                              {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {SCOPE_LABELS[role.dataScope ?? "own"] ?? role.dataScope}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={role.isSystem ? "secondary" : "outline"} className="text-xs">
                            {role.isSystem ? "System" : "Custom"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center text-sm text-muted-foreground">
                          {role.memberCount ?? 0}
                        </TableCell>
                        <TableCell className="text-center text-sm text-muted-foreground">
                          {role.permissions?.filter(p => p.allowed).length ?? 0}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Can permission="roles.view">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEditRole(role)}
                                title="Edit role"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Can>
                            <Can permission="roles.create">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDuplicateRole(role.id)}
                                disabled={duplicatingId === role.id}
                                title="Duplicate role"
                              >
                                {duplicatingId === role.id
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : <Copy className="h-4 w-4" />
                                }
                              </Button>
                            </Can>
                            <Can permission="roles.delete">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteRoleId(role.id)}
                                disabled={role.isSystem || (role.memberCount ?? 0) > 0}
                                title={role.isSystem ? "Cannot delete system roles" : (role.memberCount ?? 0) > 0 ? "Remove all members first" : "Delete role"}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </Can>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Teams Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="teams" className="mt-5">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <UsersIcon className="h-4 w-4" /> Teams
                </CardTitle>
                <Button size="sm" variant="cta" onClick={openNewTeam}>
                  <Plus className="h-4 w-4 mr-1.5" /> New Team
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {teamsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !teams?.length ? (
                <div className="text-center py-10 text-muted-foreground">
                  <UsersIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No teams yet.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={openNewTeam}>
                    <Plus className="h-4 w-4 mr-1.5" /> Create your first team
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead className="text-center">Members</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teams.map(team => {
                      const manager = users?.find(u => u.id === team.managerId);
                      return (
                        <TableRow key={team.id}>
                          <TableCell>
                            <p className="font-medium text-sm">{team.name}</p>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {manager
                              ? (manager.firstName && manager.lastName ? `${manager.firstName} ${manager.lastName}` : manager.username)
                              : <span className="italic">None</span>}
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">
                            {team.memberIds?.length ?? 0}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEditTeam(team)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTeamId(team.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── User Overrides Tab ────────────────────────────────────────── */}
        <Can permission="roles.edit">
          <TabsContent value="overrides" className="mt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserCheck className="h-4 w-4" /> User Permission Overrides
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UserPermissionOverridesPanel />
              </CardContent>
            </Card>
          </TabsContent>
        </Can>
      </Tabs>

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}

      <RoleEditorDialog
        role={editingRole}
        open={roleEditorOpen}
        onClose={() => setRoleEditorOpen(false)}
        onSaved={() => refetchRoles()}
      />

      <TeamEditorDialog
        team={editingTeam}
        open={teamEditorOpen}
        onClose={() => setTeamEditorOpen(false)}
        onSaved={() => refetchTeams()}
      />

      <Dialog open={deleteRoleId !== null} onOpenChange={o => { if (!o) setDeleteRoleId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Role</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this role? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRoleId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteRole} disabled={deleteRole.isPending}>
              {deleteRole.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTeamId !== null} onOpenChange={o => { if (!o) setDeleteTeamId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this team? Members will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTeamId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteTeam} disabled={deleteTeam.isPending}>
              {deleteTeam.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
