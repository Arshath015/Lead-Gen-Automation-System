import { Router, type IRouter, type Request, type Response } from "express";
import { db, rolesTable, rolePermissionsTable, roleDashboardWidgetsTable, auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission, invalidatePermCache } from "../lib/permissions";

const router: IRouter = Router();

async function roleToDto(role: typeof rolesTable.$inferSelect) {
  const permissions = await db.select().from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.roleId, role.id));
  const widgets = await db.select().from(roleDashboardWidgetsTable)
    .where(eq(roleDashboardWidgetsTable.roleId, role.id));
  const [memberRow] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(eq(usersTable.roleId, role.id));
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? null,
    dataScope: role.dataScope,
    isSystem: role.isSystem,
    isDefault: role.isDefault,
    hierarchy: role.hierarchy,
    workspaceId: role.workspaceId ?? null,
    permissions,
    widgets,
    memberCount: Number(memberRow?.count ?? 0),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

// GET /roles/my-widgets — workspace-scoped widget visibility for the current user's role
router.get("/roles/my-widgets", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user!.workspaceId ?? null;
  const roleId = req.user!.roleId;
  if (!roleId) { res.json({ widgets: [] }); return; }
  const [roleRow] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.id, roleId), wsFilter(rolesTable.workspaceId, wid)));
  if (!roleRow) { res.json({ widgets: [] }); return; }
  const widgets = await db.select().from(roleDashboardWidgetsTable)
    .where(eq(roleDashboardWidgetsTable.roleId, roleRow.id));
  res.json({ widgets: widgets.filter(w => w.visible) });
});

// GET /roles — list all roles for current workspace
router.get("/roles", requirePermission("roles.view"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const roles = await db.select().from(rolesTable)
    .where(wsFilter(rolesTable.workspaceId, wid))
    .orderBy(rolesTable.hierarchy);
  const dtos = await Promise.all(roles.map(roleToDto));
  res.json(dtos);
});

// POST /roles — create a custom role
router.post("/roles", requirePermission("roles.create"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const { name, description, dataScope } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [role] = await db.insert(rolesTable).values({
    name,
    description: description ?? null,
    dataScope: dataScope ?? "own",
    isSystem: false,
    isDefault: false,
    hierarchy: 9,
    workspaceId: wid,
  }).returning();
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "created",
    tableName: "roles",
    fieldName: "name",
    newValue: name,
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  });
  res.status(201).json(await roleToDto(role));
});

// GET /roles/:id
router.get("/roles/:id", requirePermission("roles.view"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const id = Number(req.params.id);
  const [role] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await roleToDto(role));
});

// PATCH /roles/:id
router.patch("/roles/:id", requirePermission("roles.edit"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.isSystem) { res.status(400).json({ error: "Cannot rename system roles" }); return; }
  const { name, description, dataScope } = req.body;
  const updateData: Partial<typeof rolesTable.$inferInsert> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (dataScope !== undefined) updateData.dataScope = dataScope;
  const [role] = await db.update(rolesTable).set(updateData)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)))
    .returning();
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "updated",
    tableName: "roles",
    fieldName: Object.keys(updateData).join(","),
    oldValue: JSON.stringify({ name: existing.name, description: existing.description }),
    newValue: JSON.stringify(updateData),
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  });
  res.json(await roleToDto(role));
});

// DELETE /roles/:id
router.delete("/roles/:id", requirePermission("roles.delete"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const id = Number(req.params.id);
  const [role] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  if (role.isSystem) { res.status(400).json({ error: "Cannot delete system roles" }); return; }
  await db.delete(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "deleted",
    tableName: "roles",
    fieldName: "name",
    oldValue: role.name,
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  });
  res.status(204).send();
});

// PUT /roles/:id/permissions — replace all permissions for a role
router.put("/roles/:id/permissions", requirePermission("roles.edit"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const id = Number(req.params.id);
  const [role] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) { res.status(400).json({ error: "permissions must be an array" }); return; }

  await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));
  if (permissions.length > 0) {
    await db.insert(rolePermissionsTable).values(
      permissions.map((p: { module: string; action: string; allowed: boolean }) => ({
        roleId: id, module: p.module, action: p.action, allowed: !!p.allowed,
      }))
    );
  }
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "updated",
    tableName: "role_permissions",
    fieldName: "permissions",
    newValue: `${permissions.filter((p: any) => p.allowed).length} permissions granted for role: ${role.name}`,
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  });
  // Invalidate cache for all users carrying this role
  const affected = await db
    .select({ numId: usersTable.numId, workspaceId: usersTable.workspaceId })
    .from(usersTable)
    .where(eq(usersTable.roleId, id));
  for (const u of affected) invalidatePermCache(u.numId, u.workspaceId);

  const updated = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));
  res.json(updated);
});

// PUT /roles/:id/widgets — replace widget visibility for a role
router.put("/roles/:id/widgets", requirePermission("roles.edit"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const id = Number(req.params.id);
  const [role] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  const { widgets } = req.body;
  if (!Array.isArray(widgets)) { res.status(400).json({ error: "widgets must be an array" }); return; }

  await db.delete(roleDashboardWidgetsTable).where(eq(roleDashboardWidgetsTable.roleId, id));
  if (widgets.length > 0) {
    await db.insert(roleDashboardWidgetsTable).values(
      widgets.map((w: { widgetKey: string; visible?: boolean }) => ({
        roleId: id, widgetKey: w.widgetKey, visible: w.visible !== false,
      }))
    );
  }
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "updated",
    tableName: "role_dashboard_widgets",
    fieldName: "widgets",
    newValue: `${widgets.filter((w: any) => w.visible !== false).length} widgets visible`,
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  });
  const updated = await db.select().from(roleDashboardWidgetsTable)
    .where(eq(roleDashboardWidgetsTable.roleId, id));
  res.json(updated);
});

// POST /roles/:id/duplicate — clone a role with all its permissions and widgets
router.post("/roles/:id/duplicate", requirePermission("roles.create"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const id = Number(req.params.id);
  const [source] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }
  const newName = (req.body?.name as string | undefined) || `${source.name} (Copy)`;
  const [copy] = await db.insert(rolesTable).values({
    name: newName,
    description: source.description,
    dataScope: source.dataScope,
    isSystem: false,
    isDefault: false,
    hierarchy: source.hierarchy,
    workspaceId: wid,
  }).returning();
  const perms = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));
  if (perms.length > 0) {
    await db.insert(rolePermissionsTable).values(
      perms.map(p => ({ roleId: copy.id, module: p.module, action: p.action, allowed: p.allowed }))
    );
  }
  const widgs = await db.select().from(roleDashboardWidgetsTable).where(eq(roleDashboardWidgetsTable.roleId, id));
  if (widgs.length > 0) {
    await db.insert(roleDashboardWidgetsTable).values(
      widgs.map(w => ({ roleId: copy.id, widgetKey: w.widgetKey, visible: w.visible }))
    );
  }
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "created",
    tableName: "roles",
    fieldName: "name",
    newValue: `Duplicated from '${source.name}': '${newName}'`,
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  });
  res.status(201).json(await roleToDto(copy));
});

// GET /roles/:id/members — list users assigned to this role
router.get("/roles/:id/members", requirePermission("roles.view"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const id = Number(req.params.id);
  const [role] = await db.select({ id: rolesTable.id }).from(rolesTable)
    .where(and(eq(rolesTable.id, id), wsFilter(rolesTable.workspaceId, wid)));
  if (!role) { res.status(404).json({ error: "Not found" }); return; }
  const members = await db.select().from(usersTable)
    .where(and(eq(usersTable.roleId, id), wsFilter(usersTable.workspaceId, wid)));
  res.json(members.map(u => ({
    id: u.numId,
    firstName: u.firstName ?? null,
    lastName: u.lastName ?? null,
    email: u.email ?? null,
    profileImage: u.profileImageUrl ?? null,
    role: u.role,
    roleId: u.roleId ?? null,
    isActive: u.isActive,
    accountStatus: u.accountStatus,
    createdAt: u.createdAt.toISOString(),
  })));
});

export default router;
