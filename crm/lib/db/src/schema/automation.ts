import { boolean, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";

export const automationTriggerEnum = pgEnum("automation_trigger", ["stage_change", "new_lead", "field_value"]);
export const automationActionEnum = pgEnum("automation_action_type", ["create_followup", "send_notification", "auto_assign"]);

export const automationRulesTable = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  trigger: automationTriggerEnum("trigger").notNull(),
  triggerValue: varchar("trigger_value", { length: 255 }),
  actionType: automationActionEnum("action_type").notNull(),
  actionValue: text("action_value"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: integer("created_by_id").references(() => usersTable.numId),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AutomationRule = typeof automationRulesTable.$inferSelect;
export type InsertAutomationRule = typeof automationRulesTable.$inferInsert;
