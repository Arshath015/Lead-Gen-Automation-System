import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db, usersTable, rolesTable, rolePermissionsTable, roleDashboardWidgetsTable,
  stagesTable, workspacesTable,
  SYSTEM_ROLES, getDefaultRolePermissions,
} from "@workspace/db";
import { seedWorkspaceRoles } from "./permissions";

// Lowercase — login handler normalises via Zod .toLowerCase() before querying
const SUPER_ADMIN_EMAIL = "arshathfarwyz015@gmail.com";

const DEFAULT_STAGES = [
  { name: "New Lead",           color: "#3b82f6", order: 1, type: "lead" as const, isWon: false, isLost: false },
  { name: "Contacted",          color: "#f59e0b", order: 2, type: "lead" as const, isWon: false, isLost: false },
  { name: "Follow-up",          color: "#06b6d4", order: 3, type: "lead" as const, isWon: false, isLost: false },
  { name: "Meeting Scheduled",  color: "#8b5cf6", order: 4, type: "lead" as const, isWon: false, isLost: false },
  { name: "Proposal Sent",      color: "#10b981", order: 5, type: "lead" as const, isWon: false, isLost: false },
  { name: "Negotiation",        color: "#f97316", order: 6, type: "lead" as const, isWon: false, isLost: false },
  { name: "Closed Won",         color: "#22c55e", order: 7, type: "lead" as const, isWon: true,  isLost: false },
  { name: "Closed Lost",        color: "#ef4444", order: 8, type: "lead" as const, isWon: false, isLost: true  },
];

const DEFAULT_DEAL_STAGES = [
  { name: "Ongoing", color: "#3b82f6", order: 1, type: "deal" as const, isWon: false, isLost: false },
  { name: "Closed",  color: "#22c55e", order: 2, type: "deal" as const, isWon: true,  isLost: false },
  { name: "Dropped", color: "#ef4444", order: 3, type: "deal" as const, isWon: false, isLost: true  },
];

export async function seedSuperAdmin() {
  const password = process.env.SUPERADMIN_INITIAL_PASSWORD;
  if (!password) return;

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, SUPER_ADMIN_EMAIL));

  let userId: number;

  if (existing?.passwordHash) {
    userId = existing.numId;
    // Repair: isSuperAdmin must ALWAYS be true for the platform super-admin.
    // This was the root cause of all 403s — it was never being set to true.
    const needsRepair =
      existing.mustChangePassword ||
      existing.accountStatus !== "active" ||
      existing.role !== "admin" ||
      !existing.isSuperAdmin;           // ← KEY FIX
    if (needsRepair) {
      await db
        .update(usersTable)
        .set({ role: "admin", accountStatus: "active", mustChangePassword: false, isSuperAdmin: true })
        .where(eq(usersTable.email, SUPER_ADMIN_EMAIL));
      console.log(`[seed] Super-admin repaired (isSuperAdmin=true): ${SUPER_ADMIN_EMAIL}`);
    }
  } else if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    const [created] = await db
      .insert(usersTable)
      .values({
        email: SUPER_ADMIN_EMAIL,
        firstName: "Super",
        lastName: "Admin",
        passwordHash,
        role: "admin",
        accountStatus: "active",
        mustChangePassword: false,
        isSuperAdmin: true,             // ← KEY FIX
      })
      .returning();
    userId = created.numId;
    console.log(`[seed] Super-admin created: ${SUPER_ADMIN_EMAIL}`);
  } else {
    // User exists but has no password — set it
    const passwordHash = await bcrypt.hash(password, 12);
    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash, role: "admin", accountStatus: "active", mustChangePassword: false, isSuperAdmin: true })
      .where(eq(usersTable.email, SUPER_ADMIN_EMAIL))
      .returning();
    userId = updated!.numId;
    console.log(`[seed] Super-admin password initialised: ${SUPER_ADMIN_EMAIL}`);
  }

  // Ensure global roles (workspaceId=null) exist and user has the Admin role
  await ensureGlobalRoles(userId!);

  // Ensure basic pipeline stages exist (workspaceId=null → visible to this user)
  await ensureDefaultStages();

  // Repair any workspace whose roles have lost their permissions (e.g. after a DB reset)
  await ensureWorkspaceRolePermissions();

  // Backfill roleId for any active users who got approved before this fix
  await backfillUserRoleIds();
}

/**
 * Create or repair global roles (workspaceId = null).
 * Assigns the "Admin" role to the super-admin user if they don't have one.
 */
async function ensureGlobalRoles(userId: number): Promise<void> {
  for (const sr of SYSTEM_ROLES) {
    const [existing] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(and(eq(rolesTable.name, sr.name), isNull(rolesTable.workspaceId)));

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
          workspaceId: null,
        })
        .returning();
      roleId = created.id;
    } else {
      roleId = existing.id;
    }

    // Replace permissions for this role
    await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, roleId));
    const perms = getDefaultRolePermissions(sr.key);
    if (perms.length > 0) {
      await db.insert(rolePermissionsTable).values(perms.map(p => ({ ...p, roleId })));
    }

    // Default dashboard widgets
    await db.delete(roleDashboardWidgetsTable).where(eq(roleDashboardWidgetsTable.roleId, roleId));
    const widgets = [
      { widgetKey: "nav_dashboard",          visible: true },
      { widgetKey: "nav_leads",              visible: true },
      { widgetKey: "nav_contacts",           visible: sr.key !== "finance" },
      { widgetKey: "nav_deals",              visible: sr.key !== "finance" },
      { widgetKey: "nav_activities",         visible: true },
      { widgetKey: "nav_reports",            visible: ["workspace_super_admin","admin","manager","finance","operations"].includes(sr.key) },
      { widgetKey: "nav_users",              visible: ["workspace_super_admin","admin","manager"].includes(sr.key) },
      { widgetKey: "nav_audit",              visible: ["workspace_super_admin","admin"].includes(sr.key) },
      { widgetKey: "nav_roles",              visible: ["workspace_super_admin","admin"].includes(sr.key) },
      { widgetKey: "nav_settings",           visible: ["workspace_super_admin","admin","operations"].includes(sr.key) },
      { widgetKey: "widget_stats_bar",       visible: true },
      { widgetKey: "widget_stage_chart",     visible: ["workspace_super_admin","admin","manager","sales"].includes(sr.key) },
      { widgetKey: "widget_funnel",          visible: ["workspace_super_admin","admin","manager"].includes(sr.key) },
      { widgetKey: "widget_recent_activity", visible: true },
    ];
    await db.insert(roleDashboardWidgetsTable).values(widgets.map(w => ({ ...w, roleId })));
  }

  // Assign the global "Admin" role to the super-admin user if not already set
  const [user] = await db.select({ roleId: usersTable.roleId }).from(usersTable).where(eq(usersTable.numId, userId));
  if (!user?.roleId) {
    const [adminRole] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(and(eq(rolesTable.name, "Admin"), isNull(rolesTable.workspaceId)));
    if (adminRole) {
      await db.update(usersTable).set({ roleId: adminRole.id }).where(eq(usersTable.numId, userId));
      console.log(`[seed] Super-admin assigned Admin role (id=${adminRole.id})`);
    }
  }
}

/**
 * For every existing workspace, check whether its roles have any permissions.
 * If a workspace's roles are all empty (e.g. after a DB reset wiped role_permissions),
 * re-seed them via seedWorkspaceRoles so users in that workspace get their access back.
 */
async function ensureWorkspaceRolePermissions(): Promise<void> {
  const workspaces = await db.select({ id: workspacesTable.id }).from(workspacesTable);

  for (const ws of workspaces) {
    // Count permissions rows that belong to roles in this workspace
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rolePermissionsTable)
      .innerJoin(rolesTable, eq(rolesTable.id, rolePermissionsTable.roleId))
      .where(eq(rolesTable.workspaceId, ws.id));

    if (count === 0) {
      console.log(`[seed] Workspace ${ws.id} roles have no permissions — re-seeding…`);
      await seedWorkspaceRoles(ws.id);
      console.log(`[seed] Workspace ${ws.id} role permissions restored`);
    }
  }
}

/** Maps the legacy role string to the system role display name */
const ROLE_STRING_TO_NAME: Record<string, string> = {
  admin:   "Admin",
  manager: "Manager",
  bd:      "Sales Member",
};

/**
 * Backfills roleId for any active users who have a role string set
 * but roleId = null (i.e. approved before the roleId-at-approval fix).
 * Runs at startup; idempotent — skips users that already have a roleId.
 */
async function backfillUserRoleIds(): Promise<void> {
  const brokenUsers = await db
    .select({
      numId: usersTable.numId,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
    })
    .from(usersTable)
    .where(and(isNull(usersTable.roleId), eq(usersTable.accountStatus, "active")));

  if (brokenUsers.length === 0) return;

  // Load all roles once to avoid N+1
  const allRoles = await db
    .select({ id: rolesTable.id, name: rolesTable.name, workspaceId: rolesTable.workspaceId })
    .from(rolesTable);

  let fixed = 0;
  for (const u of brokenUsers) {
    const roleName = ROLE_STRING_TO_NAME[u.role ?? ""] ?? null;
    if (!roleName) continue;

    const wsMatch  = allRoles.find(r => r.name === roleName && r.workspaceId === u.workspaceId);
    const glbMatch = allRoles.find(r => r.name === roleName && r.workspaceId == null);
    const match = wsMatch ?? glbMatch;
    if (!match) continue;

    await db.update(usersTable).set({ roleId: match.id }).where(eq(usersTable.numId, u.numId));
    fixed++;
  }

  if (fixed > 0) {
    console.log(`[seed] Backfilled roleId for ${fixed} user(s) who were missing it`);
  }
}

/**
 * Create default pipeline stages with workspaceId=null if none exist yet.
 * Exported so it can be called unconditionally on every startup — safe even
 * when DISABLE_AUTO_SEED=true because it is purely additive and idempotent.
 * Idempotent: checks lead stages and deal stages independently so adding
 * a new set doesn't re-seed the other.
 * The super-admin has workspaceId=null so wsFilter returns isNull(workspaceId).
 */
export async function ensureDefaultStages(): Promise<void> {
  // ── Lead stages ───────────────────────────────────────────────────────────
  const [{ leadCount }] = await db
    .select({ leadCount: sql<number>`count(*)::int` })
    .from(stagesTable)
    .where(and(isNull(stagesTable.workspaceId), eq(stagesTable.type, "lead")));

  if (leadCount === 0) {
    await db.insert(stagesTable).values(
      DEFAULT_STAGES.map(s => ({
        name: s.name,
        color: s.color,
        order: s.order,
        type: s.type,
        isWon: s.isWon,
        isLost: s.isLost,
        workspaceId: null,
      })),
    );
    console.log(`[seed] Default lead stages created (${DEFAULT_STAGES.length} stages)`);
  }

  // ── Deal stages ───────────────────────────────────────────────────────────
  const [{ dealCount }] = await db
    .select({ dealCount: sql<number>`count(*)::int` })
    .from(stagesTable)
    .where(and(isNull(stagesTable.workspaceId), eq(stagesTable.type, "deal")));

  if (dealCount === 0) {
    await db.insert(stagesTable).values(
      DEFAULT_DEAL_STAGES.map(s => ({
        name: s.name,
        color: s.color,
        order: s.order,
        type: s.type,
        isWon: s.isWon,
        isLost: s.isLost,
        workspaceId: null,
      })),
    );
    console.log(`[seed] Default deal stages created (${DEFAULT_DEAL_STAGES.length} stages)`);
  }
}
