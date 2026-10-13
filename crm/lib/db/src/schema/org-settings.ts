import { integer, jsonb, pgTable, serial, text, varchar } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspace";

export const orgSettingsTable = pgTable("org_settings", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  // Identity
  name: varchar("name", { length: 255 }).notNull().default("My Organisation"),
  logoUrl: varchar("logo_url", { length: 500 }),
  primaryColor: varchar("primary_color", { length: 20 }).default("#3b82f6"),
  theme: varchar("theme", { length: 20 }).default("system"),
  domain: varchar("domain", { length: 255 }),
  // Contact
  businessEmail: varchar("business_email", { length: 255 }),
  businessPhone: varchar("business_phone", { length: 50 }),
  address: text("address"),
  // Regional
  currency: varchar("currency", { length: 10 }).notNull().default("USD"),
  timezone: varchar("timezone", { length: 100 }).notNull().default("UTC"),
  // Grouped config blocks (jsonb — flexible, no rigid column per field)
  smtpConfig: jsonb("smtp_config"),       // { host, port, user, pass, from }
  whatsappConfig: jsonb("whatsapp_config"), // { phoneNumberId, apiKey, businessName }
  preferences: jsonb("preferences"),      // { dateFormat, firstDayOfWeek, language, ... }
});

export type OrgSettings = typeof orgSettingsTable.$inferSelect;
export type InsertOrgSettings = typeof orgSettingsTable.$inferInsert;
