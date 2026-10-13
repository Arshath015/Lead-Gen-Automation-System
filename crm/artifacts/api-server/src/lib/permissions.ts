import { and, eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import {
  db, usersTable, rolesTable, rolePermissionsTable, userPermissionOverridesTable,
  auditLogsTable,
  PERMISSION_MATRIX, getAllPermissions,
} from "@workspace/db";

// ── In-memory permission cache ────────────────────────────────────────────────
// Key: `${numId}_${workspaceId|null}`  Value: { perms: Set, ts: epoch ms }

const permCache = new Map<string, { perms: Set<string>; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(userId: number, workspaceId: number | null | undefined): string {
  return `${userId}_${workspaceId ?? "null"}`;
}

/**
 * Resolve the effective permission set for a user.
 * Merges role permissions with user-specific overrides (overrides win).
 * Result is cached in memory for CACHE_TTL_MS.
 */
export async function resolvePermissions(
  userId: number,
  workspaceId: number | null | undefined,
  isSuperAdmin: boolean,
): Promise<Set<string>> {
  // Platform super admin bypasses everything
  if (isSuperAdmin) {
    return new Set(getAllPermissions());
  }

  const key = cacheKey(userId, workspaceId);
  const cached = permCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.perms;

  const perms = new Set<string>();

  // Load role permissions
  const [user] = await db
    .select({ roleId: usersTable.roleId })
    .from(usersTable)
    .where(eq(usersTable.numId, userId));

  if (user?.roleId) {
    const rolePerms = await db
      .select({ module: rolePermissionsTable.module, action: rolePermissionsTable.action })
      .from(rolePermissionsTable)
      .where(
        and(
          eq(rolePermissionsTable.roleId, user.roleId),
          eq(rolePermissionsTable.allowed, true),
        ),
      );
    for (const p of rolePerms) perms.add(`${p.module}.${p.action}`);
  }

  // Apply user-specific overrides (override wins over role)
  const overrides = await db
    .select()
    .from(userPermissionOverridesTable)
    .where(eq(userPermissionOverridesTable.userId, userId));

  for (const o of overrides) {
    if (o.allowed) perms.add(`${o.module}.${o.action}`);
    else perms.delete(`${o.module}.${o.action}`);
  }

  // Only cache non-empty sets. An empty set can mean the role exists but
  // its permissions haven't been seeded yet (e.g. after a DB reset). Caching
  // it would block the user for up to CACHE_TTL_MS after the repair runs.
  if (perms.size > 0) {
    permCache.set(key, { perms, ts: Date.now() });
  }
  return perms;
}

/**
 * Invalidate cached permissions for a user — call after any role/override change.
 */
export function invalidatePermCache(userId: number, workspaceId: number | null | undefined): void {
  permCache.delete(cacheKey(userId, workspaceId));
}

/**
 * Middleware factory: require the caller to have the given permission.
 * Usage: router.delete("/leads/:id", requirePermission("leads.delete"), handler)
 */
export function requirePermission(permission: string) {
  // Validate the permission string at startup (dev guard)
  const [mod, action] = permission.split(".");
  if (!(mod in PERMISSION_MATRIX) || !(PERMISSION_MATRIX as Record<string, readonly string[]>)[mod]?.includes(action)) {
    // Unknown permission — treat as misconfiguration (throw at setup time)
    throw new Error(`Unknown permission: "${permission}". Check PERMISSION_MATRIX.`);
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = req.user as Express.User & { isSuperAdmin?: boolean };

    // Platform super admin bypasses all workspace permission checks
    if (user.isSuperAdmin) { next(); return; }

    const perms = await resolvePermissions(
      user.id,
      user.workspaceId,
      false,
    );

    if (!perms.has(permission)) {
      // Structured log so every 403 is diagnosable from server logs
      req.log.warn({
        userId: user.id,
        workspaceId: user.workspaceId ?? null,
        isSuperAdmin: user.isSuperAdmin ?? false,
        requiredPermission: permission,
        method: req.method,
        path: req.path,
        roleId: user.roleId ?? null,
        permCount: perms.size,
      }, "403 Forbidden: insufficient permissions");

      // Audit trail
      db.insert(auditLogsTable).values({
        leadId: null,
        userId: user.id,
        action: "unauthorized_access_attempt",
        tableName: "permissions",
        fieldName: permission,
        oldValue: null,
        newValue: `${req.method} ${req.path}`,
        ipAddress: req.ip ?? null,
        workspaceId: user.workspaceId ?? null,
      }).catch(() => {});
      res.status(403).json({ error: "Forbidden", required: permission });
      return;
    }
    next();
  };
}

/**
 * Middleware: require authenticated session (no permission check).
 * Replaces the common `if (!req.isAuthenticated()) return 401` pattern.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Guard: if the target user is a Super Admin (platform flag OR "Super Admin" role),
 * the requesting user must also be a Super Admin. Otherwise sends HTTP 403 and
 * returns false. Returns true when the action is allowed to proceed.
 */
export async function guardSuperAdmin(
  req: Request,
  res: Response,
  targetNumId: number,
): Promise<boolean> {
  const [target] = await db
    .select({ isSuperAdmin: usersTable.isSuperAdmin, roleId: usersTable.roleId })
    .from(usersTable)
    .where(eq(usersTable.numId, targetNumId));

  if (!target) return true; // Not found — let the route handle 404

  let targetIsSA = target.isSuperAdmin;
  if (!targetIsSA && target.roleId != null) {
    const [role] = await db
      .select({ name: rolesTable.name })
      .from(rolesTable)
      .where(eq(rolesTable.id, target.roleId));
    targetIsSA = role?.name === "Super Admin";
  }

  if (!targetIsSA) return true; // Not a Super Admin — no restriction

  const actor = req.user as Express.User & { isSuperAdmin?: boolean; roleId?: number | null };
  let actorIsSA = actor.isSuperAdmin ?? false;
  if (!actorIsSA && actor.roleId != null) {
    const [role] = await db
      .select({ name: rolesTable.name })
      .from(rolesTable)
      .where(eq(rolesTable.id, actor.roleId));
    actorIsSA = role?.name === "Super Admin";
  }

  if (!actorIsSA) {
    res.status(403).json({ error: "You do not have permission to modify a Super Admin account." });
    return false;
  }
  return true;
}

/**
 * Seed workspace roles on first creation.
 * Called from workspace creation endpoint.
 */
export async function seedWorkspaceRoles(workspaceId: number): Promise<void> {
  const { SYSTEM_ROLES, getDefaultRolePermissions, getAllPermissions: _ap } = await import("@workspace/db");
  const { roleDashboardWidgetsTable } = await import("@workspace/db");

  for (const sr of SYSTEM_ROLES) {
    // Upsert: skip if already exists for this workspace
    const [existing] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(and(eq(rolesTable.name, sr.name), eq(rolesTable.workspaceId, workspaceId)));

    let roleId: number;
    if (!existing) {
      const [created] = await db
        .insert(rolesTable)
        .values({
          name: sr.name,
          description: sr.description,
          dataScope: sr.dataScope,
          isSystem: true,
          isDefault: sr.isDefault,
          hierarchy: sr.hierarchy,
          workspaceId,
        })
        .returning();
      roleId = created.id;
    } else {
      roleId = existing.id;
    }

    // Replace permissions
    await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, roleId));
    const perms = getDefaultRolePermissions(sr.key);
    if (perms.length > 0) {
      await db.insert(rolePermissionsTable).values(perms.map(p => ({ ...p, roleId })));
    }

    // Default widgets for all system roles
    await db.delete(roleDashboardWidgetsTable).where(eq(roleDashboardWidgetsTable.roleId, roleId));
    // Finance role: sees only Deals (read-only) + Settings; all other modules hidden.
    const isFinance = sr.key === "finance";
    const widgets = [
      { widgetKey: "nav_dashboard",      visible: !isFinance },
      { widgetKey: "nav_leads",          visible: !isFinance },
      { widgetKey: "nav_contacts",       visible: !isFinance },
      { widgetKey: "nav_deals",          visible: true },          // Finance sees Deals
      { widgetKey: "nav_activities",     visible: !isFinance },
      { widgetKey: "nav_reports",        visible: ["workspace_super_admin","admin","manager","operations"].includes(sr.key) },
      { widgetKey: "nav_users",          visible: ["workspace_super_admin","admin","manager"].includes(sr.key) },
      { widgetKey: "nav_audit",          visible: ["workspace_super_admin","admin"].includes(sr.key) },
      { widgetKey: "nav_roles",          visible: ["workspace_super_admin","admin"].includes(sr.key) },
      { widgetKey: "nav_settings",       visible: ["workspace_super_admin","admin","operations"].includes(sr.key) },
      { widgetKey: "widget_stats_bar",   visible: !isFinance },
      { widgetKey: "widget_stage_chart", visible: ["workspace_super_admin","admin","manager","sales"].includes(sr.key) },
      { widgetKey: "widget_funnel",      visible: ["workspace_super_admin","admin","manager"].includes(sr.key) },
      { widgetKey: "widget_recent_activity", visible: !isFinance },
    ];
    await db.insert(roleDashboardWidgetsTable).values(widgets.map(w => ({ ...w, roleId })));
  }
}
