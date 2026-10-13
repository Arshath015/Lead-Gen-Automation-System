/**
 * seed-fresh — fully seeds a freshly wiped database.
 *
 * Creates (in order):
 *   1. Default workspace
 *   2. All system roles with permissions and dashboard widgets
 *   3. Pipeline stages
 *   4. Super-admin user linked to the workspace
 *
 * Required env:
 *   SUPERADMIN_INITIAL_PASSWORD — password for the admin user
 *
 * Optional env:
 *   SEED_ADMIN_EMAIL      — defaults to "Pitcsleads@gmail.com"
 *   SEED_ADMIN_FIRSTNAME  — defaults to "Super"
 *   SEED_ADMIN_LASTNAME   — defaults to "Admin"
 *   SEED_WORKSPACE_NAME   — defaults to "Rapport"
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed-fresh
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, workspacesTable, rolesTable, rolePermissionsTable,
  roleDashboardWidgetsTable, usersTable, stagesTable,
  SYSTEM_ROLES, getDefaultRolePermissions } from "@workspace/db";

// Store email lowercase — login handler normalises via Zod .toLowerCase() before querying
const ADMIN_EMAIL     = (process.env.SEED_ADMIN_EMAIL ?? "Pitcsleads@gmail.com").toLowerCase();
const ADMIN_FIRSTNAME = process.env.SEED_ADMIN_FIRSTNAME ?? "Super";
const ADMIN_LASTNAME  = process.env.SEED_ADMIN_LASTNAME  ?? "Admin";
const WORKSPACE_NAME  = process.env.SEED_WORKSPACE_NAME  ?? "Rapport";
const ADMIN_PASSWORD  = process.env.SUPERADMIN_INITIAL_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error(
    "[seed-fresh] SUPERADMIN_INITIAL_PASSWORD (or SEED_ADMIN_PASSWORD) must be set.",
  );
  process.exit(1);
}

const DEFAULT_STAGES = [
  { name: "New Lead",      color: "#6366f1", order: 0, isDefault: true,  isWon: false, isLost: false },
  { name: "Contacted",     color: "#8b5cf6", order: 1, isDefault: false, isWon: false, isLost: false },
  { name: "Qualified",     color: "#f59e0b", order: 2, isDefault: false, isWon: false, isLost: false },
  { name: "Proposal Sent", color: "#3b82f6", order: 3, isDefault: false, isWon: false, isLost: false },
  { name: "Negotiation",   color: "#f97316", order: 4, isDefault: false, isWon: false, isLost: false },
  { name: "Won",           color: "#10b981", order: 5, isDefault: false, isWon: true,  isLost: false },
  { name: "Lost",          color: "#ef4444", order: 6, isDefault: false, isWon: false, isLost: true  },
];

const WIDGET_VISIBILITY: Record<string, (key: string) => boolean> = {
  nav_dashboard:          () => true,
  nav_leads:              (k) => k !== "finance",
  nav_contacts:           (k) => k !== "finance",
  nav_deals:              (k) => k !== "finance",
  nav_activities:         () => true,
  nav_reports:            (k) => ["workspace_super_admin","admin","manager","finance","operations"].includes(k),
  nav_users:              (k) => ["workspace_super_admin","admin","manager"].includes(k),
  nav_audit:              (k) => ["workspace_super_admin","admin"].includes(k),
  nav_roles:              (k) => ["workspace_super_admin","admin"].includes(k),
  nav_settings:           (k) => ["workspace_super_admin","admin","operations"].includes(k),
  widget_stats_bar:       () => true,
  widget_stage_chart:     (k) => ["workspace_super_admin","admin","manager","sales"].includes(k),
  widget_funnel:          (k) => ["workspace_super_admin","admin","manager"].includes(k),
  widget_recent_activity: () => true,
};

async function seedFresh() {
  console.log("🌱  Starting fresh seed…\n");

  // ── 1. Workspace ─────────────────────────────────────────────────────────────
  const wsId = crypto.randomBytes(6).toString("hex");
  const [workspace] = await db.insert(workspacesTable).values({
    workspaceId: wsId,
    name: WORKSPACE_NAME,
    timezone: "UTC",
    currency: "INR",
    status: "active",
  }).returning();
  console.log(`✅  Workspace:  ${workspace.name} (id=${workspace.id}, workspaceId=${workspace.workspaceId})`);

  // ── 2. System roles + permissions + widgets ──────────────────────────────────
  let adminRoleId: number | undefined;

  for (const sr of SYSTEM_ROLES) {
    const [role] = await db.insert(rolesTable).values({
      name:        sr.name,
      description: sr.description,
      dataScope:   sr.dataScope,
      isSystem:    true,
      isDefault:   sr.isDefault,
      hierarchy:   sr.hierarchy,
      workspaceId: workspace.id,
    }).returning();

    const perms = getDefaultRolePermissions(sr.key);
    if (perms.length > 0) {
      await db.insert(rolePermissionsTable).values(perms.map(p => ({ ...p, roleId: role.id })));
    }
    const allowedCount = perms.filter(p => p.allowed).length;

    const widgets = Object.entries(WIDGET_VISIBILITY).map(([widgetKey, fn]) => ({
      roleId: role.id, widgetKey, visible: fn(sr.key),
    }));
    await db.insert(roleDashboardWidgetsTable).values(widgets);

    if (sr.name === "Admin") adminRoleId = role.id;

    console.log(`   • Role: ${sr.name.padEnd(20)} (id=${role.id}, ${allowedCount} permissions allowed)`);
  }
  console.log(`✅  ${SYSTEM_ROLES.length} roles seeded`);

  // ── 3. Pipeline stages ───────────────────────────────────────────────────────
  await db.insert(stagesTable).values(
    DEFAULT_STAGES.map(s => ({ ...s, workspaceId: workspace.id })),
  );
  console.log(`✅  ${DEFAULT_STAGES.length} pipeline stages seeded`);

  // ── 4. Super-admin user ──────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD!, 12);
  const [adminUser] = await db.insert(usersTable).values({
    email:               ADMIN_EMAIL,
    firstName:           ADMIN_FIRSTNAME,
    lastName:            ADMIN_LASTNAME,
    passwordHash,
    role:                "admin",
    roleId:              adminRoleId ?? null,
    workspaceId:         workspace.id,
    isSuperAdmin:        true,
    accountStatus:       "active",
    mustChangePassword:  false,
  }).returning();
  console.log(`✅  Admin user: ${adminUser.email} (numId=${adminUser.numId}, roleId=${adminRoleId})`);

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✔  Database recreated            (fresh wipe before this run)
✔  Workspace created             ${workspace.name} (id=${workspace.id})
✔  ${SYSTEM_ROLES.length} roles seeded              Admin · Manager · Sales · …
✔  Permissions seeded            all SYSTEM_ROLES granted per PERMISSION_MATRIX
✔  ${DEFAULT_STAGES.length} pipeline stages created
✔  Admin user created            ${adminUser.email}
✔  Admin has isSuperAdmin=true
✔  Admin assigned Admin role     (id=${adminRoleId})
✔  Admin linked to workspace     (id=${workspace.id})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Login: ${adminUser.email}  /  password from SUPERADMIN_INITIAL_PASSWORD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

seedFresh()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("\n❌  Seed failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
