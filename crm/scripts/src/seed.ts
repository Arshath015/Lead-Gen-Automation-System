import {
  db, stagesTable, usersTable, rolesTable, rolePermissionsTable,
  roleDashboardWidgetsTable, workspacesTable,
  SYSTEM_ROLES, getDefaultRolePermissions,
} from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";

async function seedWorkspaceRoles(workspaceId: number | null) {
  for (const sr of SYSTEM_ROLES) {
    const whereClause = workspaceId != null
      ? and(eq(rolesTable.name, sr.name), eq(rolesTable.workspaceId, workspaceId))
      : and(eq(rolesTable.name, sr.name), isNull(rolesTable.workspaceId));

    const [existing] = await db.select({ id: rolesTable.id }).from(rolesTable).where(whereClause);

    let roleId: number;
    if (!existing) {
      console.log(`  Creating role: ${sr.name} (workspace=${workspaceId ?? "global"})...`);
      const [created] = await db.insert(rolesTable).values({
        name: sr.name,
        description: sr.description,
        dataScope: sr.dataScope,
        isSystem: true,
        isDefault: sr.isDefault,
        hierarchy: sr.hierarchy,
        workspaceId: workspaceId ?? null,
      }).returning();
      roleId = created.id;
    } else {
      console.log(`  Updating role: ${sr.name} (workspace=${workspaceId ?? "global"})...`);
      roleId = existing.id;
      await db.update(rolesTable).set({
        description: sr.description,
        dataScope: sr.dataScope,
        isDefault: sr.isDefault,
        hierarchy: sr.hierarchy,
      }).where(eq(rolesTable.id, roleId));
    }

    // Always replace permissions from source of truth
    await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, roleId));
    const perms = getDefaultRolePermissions(sr.key);
    if (perms.length > 0) {
      await db.insert(rolePermissionsTable).values(perms.map(p => ({ ...p, roleId })));
    }

    // Replace dashboard widgets
    await db.delete(roleDashboardWidgetsTable).where(eq(roleDashboardWidgetsTable.roleId, roleId));
    const widgets = [
      { widgetKey: "nav_dashboard",          visible: true },
      { widgetKey: "nav_leads",              visible: sr.key !== "finance" },
      { widgetKey: "nav_contacts",           visible: !["finance"].includes(sr.key) },
      { widgetKey: "nav_deals",              visible: !["finance"].includes(sr.key) },
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
}

async function seed() {
  // ── Stages ───────────────────────────────────────────────────────────────────
  const existingStages = await db.select().from(stagesTable).where(isNull(stagesTable.workspaceId));
  if (existingStages.length === 0) {
    console.log("Seeding default stages...");
    await db.insert(stagesTable).values([
      { name: "New Lead",      color: "#6366f1", order: 0, isDefault: true,  isWon: false, isLost: false },
      { name: "Contacted",     color: "#8b5cf6", order: 1, isDefault: false, isWon: false, isLost: false },
      { name: "Qualified",     color: "#f59e0b", order: 2, isDefault: false, isWon: false, isLost: false },
      { name: "Proposal Sent", color: "#3b82f6", order: 3, isDefault: false, isWon: false, isLost: false },
      { name: "Negotiation",   color: "#f97316", order: 4, isDefault: false, isWon: false, isLost: false },
      { name: "Won",           color: "#10b981", order: 5, isDefault: false, isWon: true,  isLost: false },
      { name: "Lost",          color: "#ef4444", order: 6, isDefault: false, isWon: false, isLost: true  },
    ]);
    console.log("Stages seeded ✓");
  } else {
    console.log("Stages already exist, skipping.");
  }

  // ── Roles for all workspaces ─────────────────────────────────────────────────
  const workspaces = await db.select({ id: workspacesTable.id, name: workspacesTable.name }).from(workspacesTable);
  if (workspaces.length > 0) {
    for (const ws of workspaces) {
      console.log(`\nSeeding roles for workspace: ${ws.name} (id=${ws.id})`);
      await seedWorkspaceRoles(ws.id);
    }
  } else {
    // No workspaces yet — seed legacy global roles
    console.log("\nSeeding global (legacy) roles...");
    await seedWorkspaceRoles(null);
  }

  // ── Sync roleId for users missing it ────────────────────────────────────────
  console.log("\nSyncing user roleIds...");
  const usersWithoutRole = await db
    .select({ numId: usersTable.numId, role: usersTable.role, workspaceId: usersTable.workspaceId })
    .from(usersTable)
    .where(isNull(usersTable.roleId));

  const legacyRoleMap: Record<string, string> = { admin: "Admin", manager: "Manager", bd: "Sales" };

  for (const u of usersWithoutRole) {
    const targetName = legacyRoleMap[u.role ?? "bd"] ?? "Sales";
    const wid = u.workspaceId;
    const whereClause = wid != null
      ? and(eq(rolesTable.name, targetName), eq(rolesTable.workspaceId, wid))
      : and(eq(rolesTable.name, targetName), isNull(rolesTable.workspaceId));
    const [role] = await db.select({ id: rolesTable.id }).from(rolesTable).where(whereClause);
    if (role) {
      await db.update(usersTable).set({ roleId: role.id }).where(eq(usersTable.numId, u.numId));
    }
  }
  console.log("User roleIds synced ✓");

  console.log("\n✅ Seed complete");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
