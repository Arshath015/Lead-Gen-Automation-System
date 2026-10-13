import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { leadsTable } from "./leads";
import { usersTable } from "./auth";
import { workspacesTable } from "./workspace";

export const attachmentsTable = pgTable("attachments", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  fileData: text("file_data"),
  uploadedById: integer("uploaded_by_id").references(() => usersTable.numId),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Attachment = typeof attachmentsTable.$inferSelect;
export type InsertAttachment = typeof attachmentsTable.$inferInsert;
