import { boolean, integer, numeric, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { stagesTable } from "./stages";
import { workspacesTable } from "./workspace";
import { importJobsTable } from "./import-jobs";

export const leadSourceEnum = pgEnum("lead_source", ["manual", "csv_import", "api", "web_form"]);
export const leadPriorityEnum = pgEnum("lead_priority", ["hot", "warm", "cold"]);
export const leadChannelEnum = pgEnum("lead_channel", ["website", "whatsapp", "instagram", "email", "apollo", "referral", "linkedin", "database", "other"]);

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  contactPerson: varchar("contact_person", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  location: varchar("location", { length: 255 }),
  designation: varchar("designation", { length: 255 }),
  industry: varchar("industry", { length: 255 }),
  linkedinUrl: varchar("linkedin_url", { length: 500 }),
  websiteUrl: varchar("website_url", { length: 500 }),
  remarks: text("remarks"),
  comment: text("comment"),
  source: leadSourceEnum("source").notNull().default("manual"),
  priority: leadPriorityEnum("priority"),
  channel: leadChannelEnum("channel"),
  valueAmount: numeric("value_amount", { precision: 15, scale: 2 }),
  currency: varchar("currency", { length: 10 }).notNull().default("USD"),
  expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  stageId: integer("stage_id").references(() => stagesTable.id),
  ownerId: integer("owner_id").references(() => usersTable.numId),
  createdById: integer("created_by_id").references(() => usersTable.numId),
  isConverted: boolean("is_converted").notNull().default(false),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  importJobId: integer("import_job_id").references(() => importJobsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Lead = typeof leadsTable.$inferSelect;
export type InsertLead = typeof leadsTable.$inferInsert;
