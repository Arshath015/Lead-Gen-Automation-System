import { integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { followupsTable } from "./followups";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";

// Separate from in-app notifications, which may be deleted when rescheduling.
export const followupReminderDeliveriesTable = pgTable("followup_reminder_deliveries", {
  id: serial("id").primaryKey(),
  followupId: integer("followup_id").notNull().references(() => followupsTable.id, { onDelete: "cascade" }),
  generation: integer("generation").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.numId, { onDelete: "cascade" }),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  // Freeze the payload across retries; Resend requires identical requests
  // when the same idempotency key is reused.
  emailTo: varchar("email_to", { length: 320 }),
  ownerName: varchar("owner_name", { length: 255 }),
  companyName: text("company_name"),
  contactPerson: text("contact_person"),
  leadId: integer("lead_id"),
  emailStatus: varchar("email_status", { length: 16 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("followup_reminder_delivery_schedule_unique").on(table.followupId, table.generation, table.userId),
  uniqueIndex("followup_reminder_delivery_idempotency_unique").on(table.idempotencyKey),
]);