import { integer, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";

export const followupStatusEnum = pgEnum("followup_status", ["pending", "completed", "rescheduled", "missed", "cancelled"]);

export const followupsTable = pgTable("followups", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  reminderGeneration: integer("reminder_generation").notNull().default(0),
  notes: text("notes"),
  status: followupStatusEnum("status").notNull().default("pending"),
  createdById: integer("created_by_id").references(() => usersTable.numId),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Followup = typeof followupsTable.$inferSelect;
export type InsertFollowup = typeof followupsTable.$inferInsert;
