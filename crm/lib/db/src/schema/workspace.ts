import { pgEnum, pgTable, serial, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const workspaceStatusEnum = pgEnum("workspace_status", ["active", "suspended", "cancelled"]);

export const workspacesTable = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  workspaceId: varchar("workspace_id", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  businessType: varchar("business_type", { length: 100 }),
  logoUrl: varchar("logo_url", { length: 500 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  website: varchar("website", { length: 500 }),
  customDomain: varchar("custom_domain", { length: 255 }),
  webToLeadTokenHash: varchar("web_to_lead_token_hash", { length: 64 }).unique(),
  address: text("address"),
  timezone: varchar("timezone", { length: 100 }).notNull().default("UTC"),
  currency: varchar("currency", { length: 10 }).notNull().default("USD"),
  industry: varchar("industry", { length: 100 }),
  employeeCount: varchar("employee_count", { length: 50 }),
  status: workspaceStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Workspace = typeof workspacesTable.$inferSelect;
export type InsertWorkspace = typeof workspacesTable.$inferInsert;
