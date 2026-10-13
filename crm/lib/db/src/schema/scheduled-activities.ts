import { integer, pgEnum, pgTable, serial, text, timestamp, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";

export const scheduledActivityTypeEnum = pgEnum("scheduled_activity_type", [
  "task", "call", "meeting", "followup",
]);

export const scheduledActivityStatusEnum = pgEnum("scheduled_activity_status", [
  "open", "completed", "overdue", "cancelled",
]);

export const scheduledActivityPriorityEnum = pgEnum("scheduled_activity_priority", [
  "low", "medium", "high",
]);

export const scheduledActivitiesTable = pgTable("scheduled_activities", {
  id: serial("id").primaryKey(),
  type: scheduledActivityTypeEnum("type").notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  leadId: integer("lead_id").references((): AnyPgColumn => leadsTable.id, { onDelete: "set null" }),
  ownerId: integer("owner_id").references((): AnyPgColumn => usersTable.numId, { onDelete: "set null" }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  priority: scheduledActivityPriorityEnum("priority").notNull().default("medium"),
  status: scheduledActivityStatusEnum("status").notNull().default("open"),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdById: integer("created_by_id").references((): AnyPgColumn => usersTable.numId, { onDelete: "set null" }),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ScheduledActivity = typeof scheduledActivitiesTable.$inferSelect;
export type InsertScheduledActivity = typeof scheduledActivitiesTable.$inferInsert;
