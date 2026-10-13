import { test, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NewLead } from "../types/lead";

let tmpDir: string;
let leadsRepository: typeof import("./leadsRepository")["leadsRepository"];
let leadActivityRepository: typeof import("./leadActivityRepository")["leadActivityRepository"];
let closeDb: typeof import("./sqlite")["closeDb"];

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-leads-repo-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ leadsRepository } = await import("./leadsRepository"));
  ({ leadActivityRepository } = await import("./leadActivityRepository"));
  ({ closeDb } = await import("./sqlite"));
});

after(async () => {
  closeDb(); // must close before the temp dir (app.db/-wal/-shm) can be removed on Windows
  delete process.env.DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  mock.restoreAll();
});

function newLead(overrides: Partial<NewLead> & { dedupKey: string }): NewLead {
  return {
    source: "import",
    sourceId: overrides.dedupKey,
    email: null,
    fullName: "Test Lead",
    title: null,
    company: null,
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

// Regression: bulkCreate used to call leadActivityRepository.record() once
// PER inserted lead — a full read-modify-write of leadActivity.json for
// every single row. For a large import (the production workbook this was
// built for has ~654K rows) that's a full-file rewrite of an ever-growing
// file, once per row: an O(N^2) I/O pattern that would never finish at real
// scale. bulkCreate must now log activity for an entire inserted batch with
// a single recordMany() call — and, now that both leads and activity are
// SQLite-backed, both the leads insert loop and the activity insert loop
// must each be wrapped in exactly one transaction, not one per row.
test("bulkCreate: inserts the whole batch and logs activity for it using exactly two transactions total (one for leads, one for activity), not one per lead", async () => {
  const execSpy = mock.method(DatabaseSync.prototype, "exec");

  const batch: NewLead[] = Array.from({ length: 120 }, (_, i) => newLead({ dedupKey: `dedup-${i}`, fullName: `Lead ${i}` }));
  const { inserted, skippedDuplicates } = await leadsRepository.bulkCreate(batch);

  assert.equal(inserted.length, 120);
  assert.equal(skippedDuplicates, 0);

  const begins = execSpy.mock.calls.filter((c) => c.arguments[0] === "BEGIN").length;
  const commits = execSpy.mock.calls.filter((c) => c.arguments[0] === "COMMIT").length;
  assert.equal(begins, 2, `expected exactly 2 transactions (leads + activity) for a 120-lead batch, got ${begins}`);
  assert.equal(commits, 2, `expected exactly 2 commits for a 120-lead batch, got ${commits}`);

  // And every inserted lead actually got its activity record — batching the
  // write must not drop any of them.
  for (const lead of inserted) {
    const events = await leadActivityRepository.listByLeadId(lead.id);
    assert.equal(events.length, 1, `expected exactly one activity event for lead ${lead.id}`);
    assert.equal(events[0].type, "lead_created");
  }
});

test("bulkCreate: still skips duplicates by dedupKey and only logs activity for the leads actually inserted", async () => {
  await leadsRepository.bulkCreate([newLead({ dedupKey: "dupe-1", fullName: "First" })]);
  const { inserted, skippedDuplicates } = await leadsRepository.bulkCreate([
    newLead({ dedupKey: "dupe-1", fullName: "First (duplicate)" }),
    newLead({ dedupKey: "unique-1", fullName: "Second" }),
  ]);

  assert.equal(skippedDuplicates, 1);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].fullName, "Second");

  const events = await leadActivityRepository.listByLeadId(inserted[0].id);
  assert.equal(events.length, 1);
});

// Dedup is enforced by the dedup_key UNIQUE index itself (INSERT ... ON
// CONFLICT DO NOTHING), not a preloaded JS Set of every existing key — this
// proves it catches a duplicate WITHIN a single batch (two new rows sharing
// a dedup_key, neither of which existed before this call) using the exact
// same mechanism as an existing-row duplicate.
test("bulkCreate: a duplicate dedup_key WITHIN the same batch is caught too, not just duplicates of already-existing leads", async () => {
  const { inserted, skippedDuplicates } = await leadsRepository.bulkCreate([
    newLead({ dedupKey: "in-batch-dupe", fullName: "First In Batch" }),
    newLead({ dedupKey: "in-batch-dupe", fullName: "Second In Batch" }),
  ]);
  assert.equal(inserted.length, 1);
  assert.equal(skippedDuplicates, 1);
  assert.equal(inserted[0].fullName, "First In Batch");
});

test("listPage: paginates with limit/offset and reports the true total regardless of page size", async () => {
  // This file's tests share one temp database and don't reset between each
  // other (same pattern as leadActivityRepository.test.ts) — scope this
  // test's assertions to a `search` filter matching only its own fixture
  // rows, rather than assuming a pristine table.
  await leadsRepository.bulkCreate(Array.from({ length: 25 }, (_, i) => newLead({ dedupKey: `page-${i}`, fullName: `PaginationFixture ${i}` })));

  const firstPage = await leadsRepository.listPage({ search: "paginationfixture", limit: 10, offset: 0 });
  assert.equal(firstPage.leads.length, 10);
  assert.equal(firstPage.total, 25);

  const secondPage = await leadsRepository.listPage({ search: "paginationfixture", limit: 10, offset: 10 });
  assert.equal(secondPage.leads.length, 10);
  assert.equal(secondPage.total, 25);

  const thirdPage = await leadsRepository.listPage({ search: "paginationfixture", limit: 10, offset: 20 });
  assert.equal(thirdPage.leads.length, 5);
  assert.equal(thirdPage.total, 25);

  // No lead appears on more than one page.
  const allIds = [...firstPage.leads, ...secondPage.leads, ...thirdPage.leads].map((l) => l.id);
  assert.equal(new Set(allIds).size, 25);
});

test("listPage: status/search filters narrow both the page and the reported total consistently", async () => {
  await leadsRepository.bulkCreate([
    newLead({ dedupKey: "filter-1", fullName: "Acme Buyer", company: "Acme Corp", status: "qualified" }),
    newLead({ dedupKey: "filter-2", fullName: "Someone Else", company: "Other Co", status: "new" }),
  ]);

  const qualifiedOnly = await leadsRepository.listPage({ status: "qualified", limit: 50, offset: 0 });
  assert.equal(qualifiedOnly.total, 1);
  assert.equal(qualifiedOnly.leads[0].fullName, "Acme Buyer");

  const searchMatch = await leadsRepository.listPage({ search: "acme", limit: 50, offset: 0 });
  assert.equal(searchMatch.total, 1);
  assert.equal(searchMatch.leads[0].company, "Acme Corp");
});

test("statusCounts: reflects true counts across the whole table, independent of any page", async () => {
  // Shared temp database across this file's tests (see the comment on the
  // listPage test above) — assert the DELTA this test's fixtures add, not
  // an absolute total.
  const before = await leadsRepository.statusCounts();
  await leadsRepository.bulkCreate([
    newLead({ dedupKey: "count-1", fullName: "A", status: "new" }),
    newLead({ dedupKey: "count-2", fullName: "B", status: "new" }),
    newLead({ dedupKey: "count-3", fullName: "C", status: "qualified" }),
  ]);

  const after = await leadsRepository.statusCounts();
  assert.equal(after.all - before.all, 3);
  assert.equal(after.new - before.new, 2);
  assert.equal(after.qualified - before.qualified, 1);
  assert.equal(after.rejected - before.rejected, 0);
});
