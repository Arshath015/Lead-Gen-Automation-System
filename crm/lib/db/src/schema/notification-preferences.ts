import { boolean, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";

export const notificationPreferencesTable = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.numId, { onDelete: "cascade" }),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(false),
  notifyOnSubordinateManualLead: boolean("notify_on_subordinate_manual_lead").notNull().default(false),
  notifyOnManagerActivity: boolean("notify_on_manager_activity").notNull().default(false),
  notifyOnAdminActivity: boolean("notify_on_admin_activity").notNull().default(false),
  notifyCallReminders: boolean("notify_call_reminders").notNull().default(false),
  notifyMeetingTaskReminders: boolean("notify_meeting_task_reminders").notNull().default(false),
  notifyNewLead: boolean("notify_new_lead").notNull().default(false),
  notifyStatusChange: boolean("notify_status_change").notNull().default(false),
  notifyImportantFieldChange: boolean("notify_important_field_change").notNull().default(false),
  notifyUrgentEscalation: boolean("notify_urgent_escalation").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationPreferences = typeof notificationPreferencesTable.$inferSelect;
export type InsertNotificationPreferences = typeof notificationPreferencesTable.$inferInsert;
