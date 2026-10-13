import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NewLead } from "../types/lead";

// Isolated per-process temp DATA_DIR (see db/persistence.test.ts / other
// tests' own comment for why this is safe) — never touches server/data, and
// never sends a real email or invokes any research/automation code path.
//
// CRITICAL: every binding backed by "./leads.routes" (which transitively
// imports leadsRepository -> jsonStore) MUST be obtained via a dynamic
// import() INSIDE before(), after DATA_DIR is set below — never a static
// top-level `import { ... } from "./leads.routes"`. jsonStore.ts resolves its
// storage directory exactly once, the instant it is first evaluated; a
// static import runs before before() and would permanently freeze that
// module's DATA_DIR to the real server/data directory for this file's entire
// process, silently making every "isolated" repository call in this suite
// write into production data instead of the temp dir (this actually
// happened once — see the regression test at the bottom of this file).
let tmpDir: string;
let leadsRepository: typeof import("../db/leadsRepository")["leadsRepository"];
let pickPatchableLeadFields: typeof import("./leads.routes")["pickPatchableLeadFields"];
let PATCHABLE_LEAD_FIELDS: typeof import("./leads.routes")["PATCHABLE_LEAD_FIELDS"];
let closeDb: typeof import("../db/sqlite")["closeDb"];

// Resolved independently of jsonStore.ts's/sqlite.ts's own DATA_DIR logic
// (same "../../data" relative formula, just written here from src/routes
// instead of src/db) so this check still catches a regression even if a
// future bug reintroduces either module's DATA_DIR being frozen to this path
// before it's overridden.
const REAL_LEADS_FILE = path.resolve(__dirname, "../../data/leads.json");
const REAL_DB_FILE = path.resolve(__dirname, "../../data/app.db");
let realLeadsSnapshotBefore: string | null;
let realDbLeadCountBefore: number | null;

// A real (read-only in intent, though node:sqlite has no read-only open
// mode used here) row count from the live server/data/app.db — using COUNT
// rather than a file-size/byte comparison because the real app.db may be
// open concurrently (e.g. the dev server) in WAL mode, where the main file's
// size can shift from ordinary WAL checkpointing alone, independent of any
// actual row being added/removed. Row count is the invariant this guard
// actually cares about.
function countRealDbLeads(): number | null {
  try {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(REAL_DB_FILE, { readOnly: true });
    try {
      return (db.prepare("SELECT COUNT(*) as c FROM leads").get() as unknown as { c: number }).c;
    } finally {
      db.close();
    }
  } catch {
    return null; // real app.db doesn't exist yet — nothing to protect
  }
}

before(async () => {
  // Snapshot the REAL data files before anything else in this suite runs
  // (including before DATA_DIR is overridden below), so the after() check at
  // the bottom has a true "untouched" baseline to compare against — both the
  // rollback JSON file (leads.json is never written by the app anymore, but
  // must still never be touched by a test) and the real SQLite database
  // (the live data store now).
  realLeadsSnapshotBefore = await fs.readFile(REAL_LEADS_FILE, "utf-8").catch(() => null);
  realDbLeadCountBefore = countRealDbLeads();

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-leads-routes-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ leadsRepository } = await import("../db/leadsRepository"));
  ({ pickPatchableLeadFields, PATCHABLE_LEAD_FIELDS } = await import("./leads.routes"));
  ({ closeDb } = await import("../db/sqlite"));
});

// This is the regression guard for the exact incident described in the
// CRITICAL comment above: three tests in this file create/update leads via
// leadsRepository, and a prior version of this file had a bug that made
// those calls silently target real server/data/leads.json. Runs after every
// test in this file has executed (before() runs are always ordered relative
// to a file's tests regardless of how many more get added later), so it
// proves the *complete* suite — not just one test in isolation — never
// touches production data.
after(async () => {
  try {
    closeDb(); // must close before the temp dir (app.db/-wal/-shm) can be removed on Windows
    const realLeadsSnapshotAfter = await fs.readFile(REAL_LEADS_FILE, "utf-8").catch(() => null);
    assert.equal(
      realLeadsSnapshotAfter,
      realLeadsSnapshotBefore,
      "REGRESSION: this suite modified the real server/data/leads.json — DATA_DIR isolation is broken"
    );
    const realDbLeadCountAfter = countRealDbLeads();
    assert.equal(
      realDbLeadCountAfter,
      realDbLeadCountBefore,
      "REGRESSION: this suite modified the real server/data/app.db leads table — DATA_DIR isolation is broken"
    );
  } finally {
    delete process.env.DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

function fixtureNewLead(overrides: Partial<NewLead> = {}): NewLead {
  return {
    source: "manual",
    sourceId: "src-1",
    dedupKey: `dedup-${Math.random()}`,
    email: null,
    fullName: "Original Name",
    title: "Original Title",
    company: "Original Co",
    companyDomain: null,
    linkedinUrl: null,
    phone: null,
    location: null,
    icpProfileId: null,
    searchRunId: null,
    raw: null,
    roleCategory: null,
    industry: null,
    sourceFile: null,
    sourceWorksheet: null,
    ...overrides,
  };
}

test("pickPatchableLeadFields: every legitimate user-editable field is whitelisted, including the newly added ones", () => {
  const editable = [
    "fullName",
    "title",
    "company",
    "companyDomain",
    "email",
    "linkedinUrl",
    "phone",
    "location",
    "icpProfileId",
  ];
  for (const field of editable) {
    assert.ok(PATCHABLE_LEAD_FIELDS.includes(field as (typeof PATCHABLE_LEAD_FIELDS)[number]), `${field} must be patchable`);
  }
});

test("pickPatchableLeadFields: passes through every newly-supported field when present in the request body", () => {
  const body = {
    fullName: "New Name",
    title: "New Title",
    company: "New Co",
    companyDomain: "newco.com",
    email: "new@newco.com",
    linkedinUrl: "https://linkedin.com/in/new",
    phone: "+1 555 0100",
    location: "Austin, TX",
    icpProfileId: "icp-42",
  };
  assert.deepEqual(pickPatchableLeadFields(body), body);
});

test("pickPatchableLeadFields: system-controlled fields are never picked, even when present in the request body", () => {
  const body = {
    id: "attacker-supplied-id",
    source: "apollo",
    sourceId: "attacker-source-id",
    dedupKey: "attacker-dedup-key",
    raw: { hacked: true },
    searchRunId: "attacker-run-id",
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
    fullName: "Still Editable",
  };
  const picked = pickPatchableLeadFields(body);
  assert.deepEqual(picked, { fullName: "Still Editable" });
  for (const forbidden of ["id", "source", "sourceId", "dedupKey", "raw", "searchRunId", "createdAt", "updatedAt"]) {
    assert.ok(!(forbidden in picked), `${forbidden} must never be patchable`);
  }
});

test("pickPatchableLeadFields: a field simply absent from the body is omitted from the result, not set to undefined", () => {
  const picked = pickPatchableLeadFields({ fullName: "Only This" });
  assert.deepEqual(Object.keys(picked), ["fullName"]);
});

test("end-to-end: a manually created lead can have every newly-supported field edited via the same update path the PATCH route uses", async () => {
  const { inserted } = await leadsRepository.bulkCreate([fixtureNewLead({ source: "manual", sourceId: "manual-src-1", dedupKey: "manual-dedup-1" })]);
  const lead = inserted[0];

  const body = {
    id: "should-be-ignored",
    fullName: "Edited Name",
    title: "Edited Title",
    company: "Edited Co",
    companyDomain: "edited.com",
    email: "edited@edited.com",
    linkedinUrl: "https://linkedin.com/in/edited",
    phone: "+1 555 0199",
    location: "Chicago, IL",
    icpProfileId: "icp-99",
  };
  const updated = await leadsRepository.update(lead.id, pickPatchableLeadFields(body));

  assert.ok(updated);
  assert.equal(updated!.id, lead.id, "id must remain the original, not the attacker-supplied value");
  assert.equal(updated!.source, "manual");
  assert.equal(updated!.sourceId, "manual-src-1");
  assert.equal(updated!.dedupKey, "manual-dedup-1");
  assert.equal(updated!.fullName, "Edited Name");
  assert.equal(updated!.title, "Edited Title");
  assert.equal(updated!.company, "Edited Co");
  assert.equal(updated!.companyDomain, "edited.com");
  assert.equal(updated!.email, "edited@edited.com");
  assert.equal(updated!.linkedinUrl, "https://linkedin.com/in/edited");
  assert.equal(updated!.phone, "+1 555 0199");
  assert.equal(updated!.location, "Chicago, IL");
  assert.equal(updated!.icpProfileId, "icp-99");
});

test("end-to-end: the same edit path works for an Apollo-sourced lead without disturbing its source/sourceId/raw", async () => {
  const apolloRaw = { organization: { primary_domain: "apollo-co.com" } };
  const { inserted } = await leadsRepository.bulkCreate([
    fixtureNewLead({
      source: "apollo",
      sourceId: "apollo-src-1",
      dedupKey: "apollo-dedup-1",
      companyDomain: "apollo-co.com",
      raw: apolloRaw,
    }),
  ]);
  const lead = inserted[0];

  const updated = await leadsRepository.update(
    lead.id,
    pickPatchableLeadFields({
      companyDomain: "corrected-domain.com",
      phone: "+1 555 0142",
      location: "Remote",
      source: "manual", // attacker/UI-bug attempt to relabel the source — must be ignored
      raw: null, // attempt to wipe the original Apollo payload — must be ignored
    })
  );

  assert.ok(updated);
  assert.equal(updated!.source, "apollo", "source must remain apollo — PATCH must never be able to relabel a lead's source");
  assert.equal(updated!.sourceId, "apollo-src-1");
  assert.deepEqual(updated!.raw, apolloRaw, "raw must be untouched by a PATCH request");
  assert.equal(updated!.companyDomain, "corrected-domain.com");
  assert.equal(updated!.phone, "+1 555 0142");
  assert.equal(updated!.location, "Remote");
});

test("end-to-end: clearing an editable field to null via PATCH (e.g. removing a phone number) is honored, not ignored", async () => {
  const { inserted } = await leadsRepository.bulkCreate([
    fixtureNewLead({ source: "manual", sourceId: "manual-src-2", dedupKey: "manual-dedup-2", phone: "+1 555 0100" }),
  ]);
  const lead = inserted[0];

  const updated = await leadsRepository.update(lead.id, pickPatchableLeadFields({ phone: null, companyDomain: null }));
  assert.equal(updated!.phone, null);
  assert.equal(updated!.companyDomain, null);
});
