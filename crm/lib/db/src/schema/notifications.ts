import { boolean, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { leadsTable } from "./leads";
import { workspacesTable } from "./workspace";

export const notificationTypeEnum = pgEnum("notification_type", [
  "followup_due", "followup_updated", "task_due", "lead_assigned", "task_assigned", "activity_due",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.numId, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  read: boolean("read").notNull().default(false),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  taskId: integer("task_id"),
  followupId: integer("followup_id"),
  scheduledActivityId: integer("scheduled_activity_id"),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
