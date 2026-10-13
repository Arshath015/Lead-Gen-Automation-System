import { integer, pgTable, primaryKey, serial, varchar } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { workspacesTable } from "./workspace";

export const tagsTable = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }).notNull().default("#6366f1"),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
});

export const leadTagsTable = pgTable("lead_tags", {
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => tagsTable.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.leadId, table.tagId] }),
}));

export type Tag = typeof tagsTable.$inferSelect;
export type InsertTag = typeof tagsTable.$inferInsert;
