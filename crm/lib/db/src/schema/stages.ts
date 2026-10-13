import { boolean, integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspace";

export const stagesTable = pgTable("stages", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }).notNull().default("#6366f1"),
  order: integer("order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
  /** Distinguishes lead pipeline stages from deal pipeline stages. */
  type: varchar("type", { length: 10 }).notNull().default("lead"),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
});

export type Stage = typeof stagesTable.$inferSelect;
export type InsertStage = typeof stagesTable.$inferInsert;
