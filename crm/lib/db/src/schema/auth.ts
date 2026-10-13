import { sql } from "drizzle-orm";
import { boolean, index, uniqueIndex, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, text, timestamp, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspace";

export const roleEnum = pgEnum("role", ["admin", "manager", "bd"]);
export const dataScopeEnum = pgEnum("data_scope", ["all", "team", "own"]);
export const accountStatusEnum = pgEnum("account_status", ["pending", "active", "rejected", "disabled"]);

// ── Roles & Permissions ──────────────────────────────────────────────────────

export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  dataScope: dataScopeEnum("data_scope").notNull().default("own"),
  isSystem: boolean("is_system").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  hierarchy: integer("hierarchy").notNull().default(9),
  workspaceId: integer("workspace_id").references((): AnyPgColumn => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("idx_roles_name_workspace").on(t.name, t.workspaceId),
]);

export const rolePermissionsTable = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  module: varchar("module", { length: 100 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  allowed: boolean("allowed").notNull().default(false),
});

export const roleDashboardWidgetsTable = pgTable("role_dashboard_widgets", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  widgetKey: varchar("widget_key", { length: 100 }).notNull(),
  visible: boolean("visible").notNull().default(true),
});

// ── Teams & Members ──────────────────────────────────────────────────────────

export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  managerId: integer("manager_id").references((): AnyPgColumn => usersTable.numId, { onDelete: "set null" }),
  workspaceId: integer("workspace_id").references((): AnyPgColumn => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const teamMembersTable = pgTable("team_members", {
  teamId: integer("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
}, (t) => [primaryKey({ columns: [t.teamId, t.userId] })]);

// ── Sessions & Users ─────────────────────────────────────────────────────────

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  numId: serial("num_id").unique().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  passwordHash: varchar("password_hash"),
  role: roleEnum("role").notNull().default("bd"),
  roleId: integer("role_id").references(() => rolesTable.id),
  teamId: integer("team_id").references((): AnyPgColumn => teamsTable.id),
  managerId: integer("manager_id").references((): AnyPgColumn => usersTable.numId, { onDelete: "set null" }),
  targetAmount: numeric("target_amount", { precision: 15, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  accountStatus: accountStatusEnum("account_status").notNull().default("active"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  phone: varchar("phone", { length: 50 }),
  department: varchar("department", { length: 100 }),
  company: varchar("company"),
  requestedRole: varchar("requested_role"),
  rejectionReason: text("rejection_reason"),
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpiry: timestamp("password_reset_expiry", { withTimezone: true }),
  passwordHistory: jsonb("password_history").$type<string[]>().default(sql`'[]'::jsonb`),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastLoginIp: varchar("last_login_ip", { length: 50 }),
  workspaceId: integer("workspace_id").references((): AnyPgColumn => workspacesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const loginHistoryTable = pgTable("login_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references((): AnyPgColumn => usersTable.numId, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 100 }),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  failureReason: varchar("failure_reason", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("IDX_login_history_user").on(t.userId)]);

// ── User Permission Overrides ─────────────────────────────────────────────────
// Per-user overrides that take precedence over their assigned role permissions.

export const userPermissionOverridesTable = pgTable("user_permission_overrides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references((): AnyPgColumn => usersTable.numId, { onDelete: "cascade" }),
  workspaceId: integer("workspace_id").references((): AnyPgColumn => workspacesTable.id, { onDelete: "cascade" }),
  module: varchar("module", { length: 100 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  allowed: boolean("allowed").notNull(),
  grantedBy: integer("granted_by").references((): AnyPgColumn => usersTable.numId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("idx_user_perm_override_uniq").on(t.userId, t.workspaceId, t.module, t.action),
  index("idx_user_perm_override_user").on(t.userId, t.workspaceId),
]);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type Role = typeof rolesTable.$inferSelect;
export type InsertRole = typeof rolesTable.$inferInsert;
export type RolePermission = typeof rolePermissionsTable.$inferSelect;
export type RoleDashboardWidget = typeof roleDashboardWidgetsTable.$inferSelect;
export type UserPermissionOverride = typeof userPermissionOverridesTable.$inferSelect;
export type Team = typeof teamsTable.$inferSelect;
export type InsertTeam = typeof teamsTable.$inferInsert;
