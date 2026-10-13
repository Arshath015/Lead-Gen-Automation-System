import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./auth";
import { contactsTable } from "./contacts";
import { dealsTable } from "./deals";
import { workspacesTable } from "./workspace";

export const notesTable = pgTable("notes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "cascade" }),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull().default("note"),
  content: text("content").notNull(),
  createdById: integer("created_by_id").references(() => usersTable.numId),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Note = typeof notesTable.$inferSelect;
export type InsertNote = typeof notesTable.$inferInsert;
