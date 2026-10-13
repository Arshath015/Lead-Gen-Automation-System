import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// Same override precedence jsonStore.ts already uses (DATA_DIR), resolved
// lazily on first real use — never at module-load time — so every existing
// test file that already does `process.env.DATA_DIR = tmpDir` before
// dynamically importing a repository gets an isolated SQLite file for free,
// with no separate override needed. DATABASE_PATH exists for the rarer case
// of wanting to point at a specific file (e.g. a named on-disk validation
// target during migration) independent of DATA_DIR.
// Exported so migrateJsonToSqlite.ts's startup safety check resolves the
// exact same data directory this module would — the JSON backup files
// (leads.json etc.) and app.db always live side by side in it.
export function resolveDataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, "../../data");
}

function resolveDbPath(): string {
  if (process.env.DATABASE_PATH) return path.resolve(process.env.DATABASE_PATH);
  return path.join(resolveDataDir(), "app.db");
}

// leads + lead_activity only — every other collection (icpProfiles,
// automationSettings, emailDrafts, followUpTasks/Messages, engagementEvents,
// signatureAssets, defaultAttachments) stays on jsonStore.ts. Those are small
// and not driven by bulk import; migrating them isn't needed to fix the
// 654K-row scalability problem this exists for, and touching them would only
// add risk without benefit.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  email TEXT,
  full_name TEXT NOT NULL,
  title TEXT,
  company TEXT,
  company_domain TEXT,
  linkedin_url TEXT,
  phone TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  icp_profile_id TEXT,
  search_run_id TEXT,
  raw TEXT,
  engagement_status TEXT NOT NULL DEFAULT 'active',
  automation_enabled INTEGER NOT NULL DEFAULT 1,
  role_category TEXT,
  industry TEXT,
  source_file TEXT,
  source_worksheet TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- dedup_key's UNIQUE constraint above already creates the index that makes
-- import dedup an indexed INSERT ... ON CONFLICT DO NOTHING instead of
-- loading every existing dedup key into a JS Set first.
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_icp_profile_id ON leads(icp_profile_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

CREATE TABLE IF NOT EXISTS lead_activity (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_activity_lead_id ON lead_activity(lead_id);
`;

// Columns added after the leads table's original CREATE TABLE — `CREATE
// TABLE IF NOT EXISTS` above never retrofits an already-existing table (our
// real app.db has 611K+ rows), so each entry here is applied via a
// conditional ALTER TABLE instead. Additive and nullable only; never rename
// or drop a column this way.
const LEAD_COLUMN_MIGRATIONS: { column: string; ddl: string }[] = [
  // Set once a lead is pushed into the external CRM (see crm/crmClient.ts) —
  // the CRM's own numeric lead id, and when the push happened. Both null
  // until then; this repo never auto-populates them, only the explicit
  // "Send to CRM" action does.
  { column: "crm_lead_id", ddl: "ALTER TABLE leads ADD COLUMN crm_lead_id INTEGER" },
  { column: "crm_pushed_at", ddl: "ALTER TABLE leads ADD COLUMN crm_pushed_at TEXT" },
];

function applyLeadColumnMigrations(database: DatabaseSync): void {
  const existing = new Set(
    (database.prepare("PRAGMA table_info(leads)").all() as unknown as { name: string }[]).map((c) => c.name)
  );
  for (const { column, ddl } of LEAD_COLUMN_MIGRATIONS) {
    if (!existing.has(column)) database.exec(ddl);
  }
}

// Exported so migrateJsonToSqlite.ts can apply the exact same schema to an
// explicit target path (a validation temp file, or the real server/data/
// app.db) without going through DATA_DIR/DATABASE_PATH resolution at all —
// a migration run needs full, independent control of both the JSON source
// directory and the SQLite target path, which is a different concern from
// "where does the running app's own connection point."
export function applySchema(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = OFF"); // matches the JSON repositories' behavior: lead_activity deletion is orchestrated explicitly by route code, not an implicit cascade
  database.exec(SCHEMA);
  applyLeadColumnMigrations(database);
}

let db: DatabaseSync | null = null;
let openedPath: string | null = null;

export function getDb(): DatabaseSync {
  const dbPath = resolveDbPath();
  if (db && openedPath === dbPath) return db;
  if (db) db.close(); // resolveDbPath() changed (e.g. DATA_DIR flipped between test files) — never keep a stale connection open
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  applySchema(db);
  openedPath = dbPath;
  return db;
}

// Test-only: closes the cached connection so the next getDb() call re-reads
// DATA_DIR/DATABASE_PATH and opens a fresh file, instead of reusing whatever
// was cached from an earlier test file's now-deleted temp directory.
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    openedPath = null;
  }
}
