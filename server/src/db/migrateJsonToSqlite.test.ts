import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureDatabaseInitialized } from "./migrateJsonToSqlite";

// Isolated temp directory per test — never touches server/data. Each test
// gets a fully fresh dataDir (no app.db, no JSON files) via beforeEach, so
// scenarios don't leak into each other.
let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-startup-check-"));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

let dataDir: string;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(tmpDir, "case-"));
});

function dbLeadCount(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (db.prepare("SELECT COUNT(*) as c FROM leads").get() as unknown as { c: number }).c;
  } finally {
    db.close();
  }
}

function sampleLead(overrides: Record<string, unknown> = {}) {
  return {
    id: `lead-${Math.random().toString(36).slice(2)}`,
    source: "manual",
    sourceId: "src-1",
    dedupKey: `dedup-${Math.random().toString(36).slice(2)}`,
    email: "jane@acme.com",
    fullName: "Jane Doe",
    title: null,
    company: "Acme",
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("ensureDatabaseInitialized: a genuinely fresh environment (no leads.json, no app.db) is left alone — no false-positive migration", () => {
  const result = ensureDatabaseInitialized(dataDir);
  assert.equal(result.action, "already_initialized");
  assert.equal(result.leadsCount, 0);
  assert.equal(require("node:fs").existsSync(path.join(dataDir, "app.db")), false, "must not create a db file when there's nothing to recover");
});

// The actual incident: app.db doesn't exist, but leads.json has real data —
// this is the exact state a hot-reloaded SQLite-backed repository would
// otherwise have silently started serving as an empty leads list.
test("ensureDatabaseInitialized: app.db missing but leads.json has data -> auto-migrates and the leads are actually there afterward", async () => {
  const leads = [sampleLead({ fullName: "Jane Doe" }), sampleLead({ fullName: "John Smith", dedupKey: "dedup-2" })];
  await fs.writeFile(path.join(dataDir, "leads.json"), JSON.stringify(leads), "utf-8");

  const result = ensureDatabaseInitialized(dataDir);

  assert.equal(result.action, "migrated");
  assert.equal(result.leadsCount, 2);
  assert.equal(dbLeadCount(path.join(dataDir, "app.db")), 2);

  // The JSON backup itself must be completely untouched by this.
  const stillThere = JSON.parse(await fs.readFile(path.join(dataDir, "leads.json"), "utf-8"));
  assert.equal(stillThere.length, 2);
});

test("ensureDatabaseInitialized: app.db exists but is empty while leads.json has data -> also recovers (not just the 'file missing' case)", async () => {
  const leads = [sampleLead()];
  await fs.writeFile(path.join(dataDir, "leads.json"), JSON.stringify(leads), "utf-8");

  // Simulate exactly the real incident: an empty app.db already exists
  // (e.g. from an earlier hot-reload that created it before this guard
  // existed).
  const emptyDb = new DatabaseSync(path.join(dataDir, "app.db"));
  emptyDb.exec(`CREATE TABLE leads (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, dedup_key TEXT UNIQUE, email TEXT, full_name TEXT,
    title TEXT, company TEXT, company_domain TEXT, linkedin_url TEXT, phone TEXT, location TEXT, status TEXT, icp_profile_id TEXT,
    search_run_id TEXT, raw TEXT, engagement_status TEXT, automation_enabled INTEGER, role_category TEXT, industry TEXT,
    source_file TEXT, source_worksheet TEXT, created_at TEXT, updated_at TEXT)`);
  emptyDb.close();

  const result = ensureDatabaseInitialized(dataDir);

  assert.equal(result.action, "migrated");
  assert.equal(result.leadsCount, 1);
  assert.equal(dbLeadCount(path.join(dataDir, "app.db")), 1);
});

test("ensureDatabaseInitialized: a database that already has real data is left completely alone, even though leads.json also has data", async () => {
  const leads = [sampleLead({ fullName: "Backup Copy" })];
  await fs.writeFile(path.join(dataDir, "leads.json"), JSON.stringify(leads), "utf-8");

  // The live database already has its OWN (different) lead — e.g. one
  // created directly through the app since the last JSON backup was taken.
  const db = new DatabaseSync(path.join(dataDir, "app.db"));
  db.exec(`CREATE TABLE leads (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, dedup_key TEXT UNIQUE, email TEXT, full_name TEXT,
    title TEXT, company TEXT, company_domain TEXT, linkedin_url TEXT, phone TEXT, location TEXT, status TEXT, icp_profile_id TEXT,
    search_run_id TEXT, raw TEXT, engagement_status TEXT, automation_enabled INTEGER, role_category TEXT, industry TEXT,
    source_file TEXT, source_worksheet TEXT, created_at TEXT, updated_at TEXT)`);
  db.prepare(
    "INSERT INTO leads (id, source, source_id, dedup_key, email, full_name, status, engagement_status, automation_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("live-lead-1", "manual", "src", "dedup-live", "live@acme.com", "Live Lead", "new", "active", 1, new Date().toISOString(), new Date().toISOString());
  db.close();

  const result = ensureDatabaseInitialized(dataDir);

  assert.equal(result.action, "already_initialized", "must never touch a database that already has data, regardless of what the JSON backup contains");
  assert.equal(result.leadsCount, 1);
  assert.equal(dbLeadCount(path.join(dataDir, "app.db")), 1);
  // The live lead is still exactly what it was — not overwritten/duplicated.
  const row = new DatabaseSync(path.join(dataDir, "app.db"), { readOnly: true });
  const fullName = (row.prepare("SELECT full_name FROM leads").get() as unknown as { full_name: string }).full_name;
  row.close();
  assert.equal(fullName, "Live Lead");
});

test("ensureDatabaseInitialized: leads.json itself is empty -> no migration attempted, no app.db created", async () => {
  await fs.writeFile(path.join(dataDir, "leads.json"), "[]", "utf-8");
  const result = ensureDatabaseInitialized(dataDir);
  assert.equal(result.action, "already_initialized");
  assert.equal(result.leadsCount, 0);
  assert.equal(require("node:fs").existsSync(path.join(dataDir, "app.db")), false);
});
