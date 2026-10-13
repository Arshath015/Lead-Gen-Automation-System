import { integer, numeric, pgTable, serial, text, timestamp, date } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";
import { dealsTable } from "./deals";

export const dealRevenueEntriesTable = pgTable("deal_revenue_entries", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => dealsTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  month: date("month").notNull(), // ISO date string, e.g. "2026-07-01"
  note: text("note"),
  createdById: integer("created_by_id").references(() => usersTable.numId),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DealRevenueEntry = typeof dealRevenueEntriesTable.$inferSelect;
export type InsertDealRevenueEntry = typeof dealRevenueEntriesTable.$inferInsert;
