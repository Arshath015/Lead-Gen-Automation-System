import { test, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Same isolation pattern as persistence.test.ts: DATA_DIR is set to a fresh
// temp directory before any repository module is imported, so this file can
// never touch server/data. SQLite-backed now (see ../sqlite.ts) — the temp
// dir gets an isolated app.db instead of/alongside the JSON files.
let tmpDir: string;
let leadActivityRepository: typeof import("./leadActivityRepository")["leadActivityRepository"];
let closeDb: typeof import("./sqlite")["closeDb"];

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-activity-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ leadActivityRepository } = await import("./leadActivityRepository"));
  ({ closeDb } = await import("./sqlite"));
});

after(async () => {
  // The SQLite connection must be closed before the temp dir can be removed
  // — Windows refuses to unlink a file (app.db/-wal/-shm) that a process
  // still has open.
  closeDb();
  delete process.env.DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  mock.restoreAll();
});

// DatabaseSync is a real native class (not tsx/esbuild-transpiled), so its
// prototype methods ARE plain configurable/writable properties — unlike
// jsonStore.ts's own exports (see the JSON-backed version of this test file
// for that whole story), mock.method() here just works directly.
function spyOnExec() {
  return mock.method(DatabaseSync.prototype, "exec");
}

test("record: creates a single event with the given fields, metadata defaulting to null", async () => {
  const event = await leadActivityRepository.record("lead-1", "lead_created", "Lead added manually");
  assert.equal(event.leadId, "lead-1");
  assert.equal(event.type, "lead_created");
  assert.equal(event.summary, "Lead added manually");
  assert.equal(event.metadata, null);
  assert.ok(event.id);
  assert.ok(event.createdAt);

  const events = await leadActivityRepository.listByLeadId("lead-1");
  assert.ok(events.some((e) => e.id === event.id));
});

test("recordMany: writes every event in the batch, each with its own id and the given leadId/type/summary/metadata", async () => {
  const created = await leadActivityRepository.recordMany([
    { leadId: "lead-a", type: "lead_created", summary: "Lead found via import" },
    { leadId: "lead-b", type: "lead_created", summary: "Lead found via import" },
    { leadId: "lead-c", type: "lead_created", summary: "Lead found via import", metadata: { sourceFile: "x.xlsx" } },
  ]);

  assert.equal(created.length, 3);
  const ids = new Set(created.map((e) => e.id));
  assert.equal(ids.size, 3); // every event gets its own distinct id, not shared

  assert.equal((await leadActivityRepository.listByLeadId("lead-a")).length, 1);
  assert.equal((await leadActivityRepository.listByLeadId("lead-b")).length, 1);
  const [cEvent] = await leadActivityRepository.listByLeadId("lead-c");
  assert.deepEqual(cEvent.metadata, { sourceFile: "x.xlsx" });
});

test("recordMany: an empty batch is a no-op — returns [] and doesn't even open a transaction", async () => {
  const execSpy = spyOnExec();
  const result = await leadActivityRepository.recordMany([]);
  assert.deepEqual(result, []);
  assert.equal(execSpy.mock.calls.filter((c) => c.arguments[0] === "BEGIN").length, 0);
});

test("recordMany: wraps an entire N-event batch in exactly ONE transaction (one BEGIN, one COMMIT), regardless of N — the fix for the O(N^2) per-lead import pattern", async () => {
  const execSpy = spyOnExec();
  const events = Array.from({ length: 250 }, (_, i) => ({
    leadId: `lead-bulk-${i}`,
    type: "lead_created" as const,
    summary: "Lead found via import",
  }));
  const created = await leadActivityRepository.recordMany(events);

  assert.equal(created.length, 250);
  const begins = execSpy.mock.calls.filter((c) => c.arguments[0] === "BEGIN").length;
  const commits = execSpy.mock.calls.filter((c) => c.arguments[0] === "COMMIT").length;
  assert.equal(begins, 1, `expected exactly one BEGIN for a 250-event batch, got ${begins}`);
  assert.equal(commits, 1, `expected exactly one COMMIT for a 250-event batch, got ${commits}`);

  for (const e of created) {
    assert.equal((await leadActivityRepository.listByLeadId(e.leadId)).length, 1);
  }
});

test("recordMany is dramatically faster than the equivalent number of individual record() calls it replaces (the actual, observable O(N^2) -> O(1)-per-batch fix)", async () => {
  const N = 300;

  const oldStyleStart = performance.now();
  for (let i = 0; i < N; i++) {
    await leadActivityRepository.record(`lead-old-${i}`, "lead_created", "Lead found via import");
  }
  const oldStyleMs = performance.now() - oldStyleStart;

  const events = Array.from({ length: N }, (_, i) => ({
    leadId: `lead-newbatch-${i}`,
    type: "lead_created" as const,
    summary: "Lead found via import",
  }));
  const newStyleStart = performance.now();
  await leadActivityRepository.recordMany(events);
  const newStyleMs = performance.now() - newStyleStart;

  assert.ok(
    newStyleMs * 5 < oldStyleMs,
    `expected the batched recordMany() to be at least 5x faster than ${N} individual record() calls on the same data; old=${oldStyleMs.toFixed(1)}ms, new=${newStyleMs.toFixed(1)}ms`
  );
});

test("recordMany: appends to existing events rather than clobbering them", async () => {
  await leadActivityRepository.record("lead-append-existing", "lead_created", "Lead added manually");
  await leadActivityRepository.recordMany([
    { leadId: "lead-append-new-1", type: "lead_created", summary: "Lead found via import" },
    { leadId: "lead-append-new-2", type: "lead_created", summary: "Lead found via import" },
  ]);

  assert.equal((await leadActivityRepository.listByLeadId("lead-append-existing")).length, 1);
  assert.equal((await leadActivityRepository.listByLeadId("lead-append-new-1")).length, 1);
  assert.equal((await leadActivityRepository.listByLeadId("lead-append-new-2")).length, 1);
});

test("recordMany: a write failure rolls back the whole transaction and propagates (rejects) rather than being silently swallowed — no event is reported as saved when it wasn't", async () => {
  // A genuine, mock-free write failure: a circular reference in metadata
  // makes the real JSON.stringify inside recordMany's insert loop throw for
  // real, rather than simulating a failure by replacing sqlite internals.
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  await assert.rejects(
    () =>
      leadActivityRepository.recordMany([
        { leadId: "lead-rollback-1", type: "lead_created", summary: "Lead found via import" },
        { leadId: "lead-rollback-2", type: "lead_created", summary: "Lead found via import", metadata: circular },
      ]),
    /circular structure/i
  );

  // Neither event survives — the first event's insert is rolled back too,
  // not left half-committed just because it came before the one that failed.
  assert.deepEqual(await leadActivityRepository.listByLeadId("lead-rollback-1"), []);
  assert.deepEqual(await leadActivityRepository.listByLeadId("lead-rollback-2"), []);
});
