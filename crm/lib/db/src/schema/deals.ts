import { integer, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";
import { stagesTable } from "./stages";
import { accountsTable, contactsTable } from "./contacts";
import { leadsTable } from "./leads";

export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  value: numeric("value", { precision: 15, scale: 2 }),
  currency: varchar("currency", { length: 10 }).notNull().default("USD"),
  stageId: integer("stage_id").references(() => stagesTable.id),
  closeDate: timestamp("close_date", { withTimezone: true }),
  probability: integer("probability").default(0),
  accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  convertedFromLeadId: integer("converted_from_lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  ownerId: integer("owner_id").references(() => usersTable.numId),
  createdById: integer("created_by_id").references(() => usersTable.numId),
  notes: text("notes"),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Deal = typeof dealsTable.$inferSelect;
export type InsertDeal = typeof dealsTable.$inferInsert;
