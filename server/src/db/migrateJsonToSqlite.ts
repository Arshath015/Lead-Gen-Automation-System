// One-time migration: copies server/data/leads.json + leadActivity.json
// into a SQLite database (see ./sqlite.ts for the schema), WITHOUT ever
// modifying the source JSON files — they are only ever read here, never
// written. That's what makes them a reliable rollback backup: whether this
// script is run in validate-only mode against a throwaway target, or for
// real against server/data/app.db, the JSON files end up byte-for-byte
// identical to how they started either way.
//
// Usage (see the bottom of this file for the CLI entry point):
//   npx tsx src/db/migrateJsonToSqlite.ts --target=<path> [--source=<dir>]
//
// Always run once against a throwaway --target first and inspect the
// returned MigrationValidation before ever pointing --target at the real
// server/data/app.db.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./sqlite";
import type { Lead, LeadStatus, EngagementStatus } from "../types/lead";
import type { LeadActivityEvent, LeadActivityType } from "../types/activity";

export interface MigrationOptions {
  sourceDataDir: string;
  targetDbPath: string;
}

export interface MigrationValidation {
  ok: boolean;
  leadsSourceCount: number;
  leadsTargetCount: number;
  activitySourceCount: number;
  activityTargetCount: number;
  fieldMismatches: string[];
  orphanedActivityLeadIds: string[];
  crud: { getById: boolean; update: boolean; filteredList: boolean; dedupIndexRejectsDuplicate: boolean; deleteCleanup: boolean };
  errors: string[];
}

function readJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return [];
  return JSON.parse(raw) as T[];
}

// Mirrors legacy/jsonLeadsRepository.ts's normalize() defaults exactly —
// some real records on disk predate these fields and must migrate with the
// same implicit values the JSON repository always gave them on read, not
// silently as null/undefined.
function normalizeLegacyLead(raw: Record<string, unknown>): Lead {
  return {
    id: raw.id as string,
    source: raw.source as string,
    sourceId: raw.sourceId as string,
    dedupKey: raw.dedupKey as string,
    email: (raw.email as string | null) ?? null,
    fullName: raw.fullName as string,
    title: (raw.title as string | null) ?? null,
    company: (raw.company as string | null) ?? null,
    companyDomain: (raw.companyDomain as string | null) ?? null,
    linkedinUrl: (raw.linkedinUrl as string | null) ?? null,
    phone: (raw.phone as string | null) ?? null,
    location: (raw.location as string | null) ?? null,
    status: (raw.status as LeadStatus) ?? "new",
    icpProfileId: (raw.icpProfileId as string | null) ?? null,
    searchRunId: (raw.searchRunId as string | null) ?? null,
    raw: raw.raw ?? null,
    engagementStatus: (raw.engagementStatus as EngagementStatus) ?? "active",
    automationEnabled: (raw.automationEnabled as boolean | undefined) ?? true,
    roleCategory: (raw.roleCategory as string | null) ?? null,
    industry: (raw.industry as string | null) ?? null,
    sourceFile: (raw.sourceFile as string | null) ?? null,
    sourceWorksheet: (raw.sourceWorksheet as string | null) ?? null,
    crmLeadId: (raw.crmLeadId as number | null) ?? null,
    crmPushedAt: (raw.crmPushedAt as string | null) ?? null,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

function normalizeLegacyActivity(raw: Record<string, unknown>): LeadActivityEvent {
  return {
    id: raw.id as string,
    leadId: raw.leadId as string,
    type: raw.type as LeadActivityType,
    summary: raw.summary as string,
    metadata: (raw.metadata as Record<string, unknown> | null) ?? null,
    createdAt: raw.createdAt as string,
  };
}

function insertLead(db: DatabaseSync, lead: Lead): void {
  db.prepare(`
    INSERT INTO leads (
      id, source, source_id, dedup_key, email, full_name, title, company, company_domain,
      linkedin_url, phone, location, status, icp_profile_id, search_run_id, raw,
      engagement_status, automation_enabled, role_category, industry, source_file, source_worksheet,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lead.id,
    lead.source,
    lead.sourceId,
    lead.dedupKey,
    lead.email,
    lead.fullName,
    lead.title,
    lead.company,
    lead.companyDomain,
    lead.linkedinUrl,
    lead.phone,
    lead.location,
    lead.status,
    lead.icpProfileId,
    lead.searchRunId,
    lead.raw != null ? JSON.stringify(lead.raw) : null,
    lead.engagementStatus,
    lead.automationEnabled ? 1 : 0,
    lead.roleCategory,
    lead.industry,
    lead.sourceFile,
    lead.sourceWorksheet,
    lead.createdAt,
    lead.updatedAt
  );
}

function insertActivity(db: DatabaseSync, event: LeadActivityEvent): void {
  db.prepare(`INSERT INTO lead_activity (id, lead_id, type, summary, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    event.id,
    event.leadId,
    event.type,
    event.summary,
    event.metadata != null ? JSON.stringify(event.metadata) : null,
    event.createdAt
  );
}

function leadFieldMismatches(source: Lead, targetRow: Record<string, unknown>): string[] {
  const mismatches: string[] = [];
  const check = (field: string, expected: unknown, actual: unknown) => {
    const expectedStr = JSON.stringify(expected);
    const actualStr = JSON.stringify(actual);
    if (expectedStr !== actualStr) mismatches.push(`lead ${source.id}: ${field} expected ${expectedStr}, got ${actualStr}`);
  };
  check("source", source.source, targetRow.source);
  check("sourceId", source.sourceId, targetRow.source_id);
  check("dedupKey", source.dedupKey, targetRow.dedup_key);
  check("email", source.email, targetRow.email);
  check("fullName", source.fullName, targetRow.full_name);
  check("title", source.title, targetRow.title);
  check("company", source.company, targetRow.company);
  check("companyDomain", source.companyDomain, targetRow.company_domain);
  check("linkedinUrl", source.linkedinUrl, targetRow.linkedin_url);
  check("phone", source.phone, targetRow.phone);
  check("location", source.location, targetRow.location);
  check("status", source.status, targetRow.status);
  check("icpProfileId", source.icpProfileId, targetRow.icp_profile_id);
  check("searchRunId", source.searchRunId, targetRow.search_run_id);
  check("raw", source.raw ?? null, targetRow.raw != null ? JSON.parse(targetRow.raw as string) : null);
  check("engagementStatus", source.engagementStatus, targetRow.engagement_status);
  check("automationEnabled", source.automationEnabled, targetRow.automation_enabled === 1);
  check("roleCategory", source.roleCategory, targetRow.role_category);
  check("industry", source.industry, targetRow.industry);
  check("sourceFile", source.sourceFile, targetRow.source_file);
  check("sourceWorksheet", source.sourceWorksheet, targetRow.source_worksheet);
  check("createdAt", source.createdAt, targetRow.created_at);
  check("updatedAt", source.updatedAt, targetRow.updated_at);
  return mismatches;
}

export function migrate({ sourceDataDir, targetDbPath }: MigrationOptions): MigrationValidation {
  const errors: string[] = [];
  const fieldMismatches: string[] = [];

  const rawLeads = readJsonArray<Record<string, unknown>>(path.join(sourceDataDir, "leads.json"));
  const rawActivity = readJsonArray<Record<string, unknown>>(path.join(sourceDataDir, "leadActivity.json"));
  const leads = rawLeads.map(normalizeLegacyLead);
  const activity = rawActivity.map(normalizeLegacyActivity);

  fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
  const db = new DatabaseSync(targetDbPath);
  applySchema(db);

  db.exec("BEGIN");
  try {
    for (const lead of leads) insertLead(db, lead);
    for (const event of activity) insertActivity(db, event);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    errors.push(`Insert phase failed: ${(err as Error).message}`);
    db.close();
    return {
      ok: false,
      leadsSourceCount: leads.length,
      leadsTargetCount: 0,
      activitySourceCount: activity.length,
      activityTargetCount: 0,
      fieldMismatches,
      orphanedActivityLeadIds: [],
      crud: { getById: false, update: false, filteredList: false, dedupIndexRejectsDuplicate: false, deleteCleanup: false },
      errors,
    };
  }

  // --- Row counts ---
  const leadsTargetCount = (db.prepare("SELECT COUNT(*) as c FROM leads").get() as unknown as { c: number }).c;
  const activityTargetCount = (db.prepare("SELECT COUNT(*) as c FROM lead_activity").get() as unknown as { c: number }).c;

  // --- Exhaustive field-by-field comparison (245 leads is small enough to
  // check every row, not just a sample) ---
  for (const lead of leads) {
    const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead.id) as unknown as Record<string, unknown> | undefined;
    if (!row) {
      fieldMismatches.push(`lead ${lead.id}: present in source JSON but missing from SQLite target`);
      continue;
    }
    fieldMismatches.push(...leadFieldMismatches(lead, row));
  }

  // --- Relationship sanity: every activity row's leadId should correspond
  // to a real lead in the source data (an orphan isn't necessarily a
  // migration bug — it could already exist in the source JSON — but it's
  // worth surfacing either way). ---
  const leadIdSet = new Set(leads.map((l) => l.id));
  const orphanedActivityLeadIds = [...new Set(activity.filter((e) => !leadIdSet.has(e.leadId)).map((e) => e.leadId))];

  // --- Representative CRUD checks against the populated target, using a
  // throwaway dummy lead that is inserted and then deleted again so it never
  // lingers in the real database if this is run against the production
  // target path. ---
  const crud = { getById: false, update: false, filteredList: false, dedupIndexRejectsDuplicate: false, deleteCleanup: false };
  try {
    if (leads.length > 0) {
      const sample = leads[0];
      const gotById = db.prepare("SELECT * FROM leads WHERE id = ?").get(sample.id) as unknown as Record<string, unknown> | undefined;
      crud.getById = !!gotById && gotById.full_name === sample.fullName;

      const before = db.prepare("SELECT status FROM leads WHERE id = ?").get(sample.id) as unknown as { status: string };
      const tempStatus: LeadStatus = before.status === "qualified" ? "new" : "qualified";
      db.prepare("UPDATE leads SET status = ? WHERE id = ?").run(tempStatus, sample.id);
      const afterUpdate = db.prepare("SELECT status FROM leads WHERE id = ?").get(sample.id) as unknown as { status: string };
      crud.update = afterUpdate.status === tempStatus;
      db.prepare("UPDATE leads SET status = ? WHERE id = ?").run(before.status, sample.id); // restore — this is a validation check, not a real edit

      const statusFilterCount = (db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = ?").get(sample.status) as unknown as { c: number }).c;
      const expectedCount = leads.filter((l) => l.status === sample.status).length;
      crud.filteredList = statusFilterCount === expectedCount;
    }

    const dummyId = "migration-validation-dummy-lead";
    const dummyDedupKey = "migration-validation-dummy-dedup-key";
    db.prepare("DELETE FROM leads WHERE id = ?").run(dummyId); // in case a previous failed run left it behind
    insertLead(db, {
      id: dummyId,
      source: "manual",
      sourceId: "migration-validation",
      dedupKey: dummyDedupKey,
      email: null,
      fullName: "Migration Validation Dummy",
      title: null,
      company: null,
      companyDomain: null,
      linkedinUrl: null,
      phone: null,
      location: null,
      status: "new",
      icpProfileId: null,
      searchRunId: null,
      raw: null,
      engagementStatus: "active",
      automationEnabled: true,
      roleCategory: null,
      industry: null,
      sourceFile: null,
      sourceWorksheet: null,
      crmLeadId: null,
      crmPushedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    let dedupRejected = false;
    try {
      db.prepare("INSERT INTO leads (id, source, source_id, dedup_key, email, full_name, status, engagement_status, automation_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        "migration-validation-dummy-lead-2",
        "manual",
        "migration-validation-2",
        dummyDedupKey, // same dedup key on purpose
        null,
        "Migration Validation Dummy 2",
        "new",
        "active",
        1,
        new Date().toISOString(),
        new Date().toISOString()
      );
    } catch {
      dedupRejected = true; // expected: UNIQUE constraint violation
    }
    crud.dedupIndexRejectsDuplicate = dedupRejected;

    db.prepare("DELETE FROM leads WHERE id = ?").run(dummyId);
    const stillThere = db.prepare("SELECT 1 FROM leads WHERE id = ?").get(dummyId);
    crud.deleteCleanup = !stillThere;
  } catch (err) {
    errors.push(`CRUD validation failed: ${(err as Error).message}`);
  }

  db.close();

  const ok =
    errors.length === 0 &&
    fieldMismatches.length === 0 &&
    leadsTargetCount === leads.length &&
    activityTargetCount === activity.length &&
    crud.getById &&
    crud.update &&
    crud.filteredList &&
    crud.dedupIndexRejectsDuplicate &&
    crud.deleteCleanup;

  return {
    ok,
    leadsSourceCount: leads.length,
    leadsTargetCount,
    activitySourceCount: activity.length,
    activityTargetCount,
    fieldMismatches,
    orphanedActivityLeadIds,
    crud,
    errors,
  };
}

// --- Startup safety guard -------------------------------------------------
//
// The exact incident this exists to prevent: a running `tsx watch` dev
// server hot-reloads (tsx watch restarts the whole process, re-running every
// top-level module, including this file's caller in index.ts) onto code
// that switched leadsRepository/leadActivityRepository to be SQLite-backed.
// server/data/app.db does not exist yet on that machine. The very next
// request calls getDb(), which — with no guard — just creates a brand-new,
// empty app.db (CREATE TABLE IF NOT EXISTS on a fresh file) and happily
// serves it: GET /api/leads returns 0 leads, silently, with no error,
// even though the real 245 leads were sitting untouched in leads.json the
// whole time. This happened for real during this project's own migration.
//
// ensureDatabaseInitialized() must be called once, explicitly, at server
// startup — BEFORE the app starts accepting any requests — so this can
// never again be discovered by a user seeing an empty leads list instead of
// by the server refusing to start.

export interface StartupCheckResult {
  action: "already_initialized" | "migrated";
  leadsCount: number;
}

function countLeadsInDb(dbPath: string): number {
  if (!fs.existsSync(dbPath)) return 0;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return (db.prepare("SELECT COUNT(*) as c FROM leads").get() as unknown as { c: number }).c;
    } finally {
      db.close();
    }
  } catch {
    // File exists but isn't a valid SQLite db yet, or the leads table
    // doesn't exist yet (e.g. a half-created file from a previous crashed
    // attempt) — treat identically to "0 leads", which is exactly the
    // state that should trigger the safety check below rather than being
    // swallowed as success.
    return 0;
  }
}

// Safe to call on every single startup/hot-reload, not just "the first
// time" — it's a no-op whenever the database already has at least as much
// data as the JSON backup would suggest it should. It only ever INSERTS
// (via migrate(), which never touches the JSON source files and only
// writes brand-new rows into what was confirmed to be an empty table), so
// there is no path through this function that can lose or overwrite
// existing SQLite data.
export function ensureDatabaseInitialized(dataDir: string): StartupCheckResult {
  const dbPath = path.join(dataDir, "app.db");
  const leadsJsonPath = path.join(dataDir, "leads.json");

  const jsonLeads = readJsonArray<Record<string, unknown>>(leadsJsonPath);
  const dbLeadCount = countLeadsInDb(dbPath);

  // The dangerous state: the JSON backup has real leads, but the live
  // database — whether because it doesn't exist yet, or exists but is
  // empty — does not. A database that legitimately has 0 leads (a fresh
  // install with no backup, or every lead having since been deleted on
  // purpose) never trips this, since there's nothing to compare it against
  // unfavorably.
  if (dbLeadCount > 0 || jsonLeads.length === 0) {
    return { action: "already_initialized", leadsCount: dbLeadCount };
  }

  console.warn(
    `[startup] ${dbPath} has ${dbLeadCount} lead(s) but ${leadsJsonPath} has ${jsonLeads.length} — ` +
      `running the JSON -> SQLite migration automatically before accepting any requests.`
  );
  const result = migrate({ sourceDataDir: dataDir, targetDbPath: dbPath });
  if (!result.ok) {
    // Never start the server against a database that failed validation —
    // that would mean silently serving incomplete/incorrect data, which is
    // exactly the failure mode this whole guard exists to prevent. Fail
    // loudly and stop the process instead.
    throw new Error(
      `[startup] SAFETY ABORT: automatic database initialization failed validation — refusing to start. ` +
        `leadsSourceCount=${result.leadsSourceCount} leadsTargetCount=${result.leadsTargetCount} ` +
        `fieldMismatches=${result.fieldMismatches.length} errors=${JSON.stringify(result.errors)}`
    );
  }
  console.warn(`[startup] Automatic migration succeeded: ${result.leadsTargetCount} leads, ${result.activityTargetCount} activity records restored from ${leadsJsonPath}.`);
  return { action: "migrated", leadsCount: result.leadsTargetCount };
}

// --- CLI entry point ---
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.join("=")];
    })
  );
  const targetDbPath = args.target ? path.resolve(args.target) : (() => { throw new Error("Usage: --target=<path> [--source=<dir>]"); })();
  const sourceDataDir = args.source ? path.resolve(args.source) : path.resolve(__dirname, "../../data");

  console.log(`Migrating from ${sourceDataDir} to ${targetDbPath} ...`);
  const result = migrate({ sourceDataDir, targetDbPath });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error("\nMigration validation FAILED — see fieldMismatches/errors/crud above.");
    process.exit(1);
  }
  console.log("\nMigration validation PASSED.");
}
