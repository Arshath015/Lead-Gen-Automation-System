import { integer, jsonb, pgEnum, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";

export const importJobStatusEnum = pgEnum("import_job_status", ["pending", "importing", "complete", "failed", "rolled_back"]);

export const importJobsTable = pgTable("import_jobs", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.numId),
  status: importJobStatusEnum("status").notNull().default("pending"),
  fileName: varchar("file_name", { length: 255 }),
  fileHash: varchar("file_hash", { length: 64 }),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  updatedRows: integer("updated_rows").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0),
  errors: jsonb("errors"),
  report: jsonb("report"),
  mappings: jsonb("mappings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rollbackedAt: timestamp("rollbacked_at", { withTimezone: true }),
});

export type ImportJob = typeof importJobsTable.$inferSelect;
export type InsertImportJob = typeof importJobsTable.$inferInsert;

export const importMappingTemplatesTable = pgTable("import_mapping_templates", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").references(() => usersTable.numId),
  name: varchar("name", { length: 100 }).notNull(),
  mappings: jsonb("mappings").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ImportMappingTemplate = typeof importMappingTemplatesTable.$inferSelect;
export type InsertImportMappingTemplate = typeof importMappingTemplatesTable.$inferInsert;
