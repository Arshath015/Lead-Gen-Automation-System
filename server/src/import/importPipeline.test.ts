import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import type { CanonicalField } from "./schema";

// Same isolation pattern as routes/leads.routes.test.ts: every binding that
// transitively touches jsonStore MUST be obtained via dynamic import() after
// DATA_DIR is overridden, and a real-file snapshot guard proves this suite
// never writes to server/data/leads.json.
let tmpDataDir: string;
let tmpFilesDir: string;
let leadsRepository: typeof import("../db/leadsRepository")["leadsRepository"];
let computePreview: typeof import("./importPipeline")["computePreview"];
let commitImport: typeof import("./importPipeline")["commitImport"];
let computeSelectionsDigest: typeof import("./importPipeline")["computeSelectionsDigest"];
let closeDb: typeof import("../db/sqlite")["closeDb"];
type ColumnMapping = import("./importPipeline").ColumnMapping;

const REAL_LEADS_FILE = path.resolve(__dirname, "../../data/leads.json");
let realLeadsSnapshotBefore: string | null;

before(async () => {
  realLeadsSnapshotBefore = await fs.readFile(REAL_LEADS_FILE, "utf-8").catch(() => null);

  tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-import-pipeline-test-data-"));
  tmpFilesDir = await fs.mkdtemp(path.join(os.tmpdir(), "stampsize-import-pipeline-test-files-"));
  process.env.DATA_DIR = tmpDataDir;
  ({ leadsRepository } = await import("../db/leadsRepository"));
  ({ computePreview, commitImport, computeSelectionsDigest } = await import("./importPipeline"));
  ({ closeDb } = await import("../db/sqlite"));
});

after(async () => {
  try {
    closeDb(); // must close before the temp dir (app.db/-wal/-shm) can be removed on Windows
    const realLeadsSnapshotAfter = await fs.readFile(REAL_LEADS_FILE, "utf-8").catch(() => null);
    assert.equal(
      realLeadsSnapshotAfter,
      realLeadsSnapshotBefore,
      "REGRESSION: this suite modified the real server/data/leads.json — DATA_DIR isolation is broken"
    );
  } finally {
    delete process.env.DATA_DIR;
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    await fs.rm(tmpFilesDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  // Reset the isolated leads collection between tests. leads/lead_activity
  // are SQLite-backed now (see ../db/sqlite.ts) — resetting means closing
  // the cached connection and deleting the db file (+ its -wal/-shm
  // sidecars) so the next getDb() call recreates a fresh, empty database
  // with the schema reapplied, rather than writing to a leads.json the
  // active repository no longer reads at all.
  closeDb();
  await fs.rm(path.join(tmpDataDir, "app.db"), { force: true });
  await fs.rm(path.join(tmpDataDir, "app.db-wal"), { force: true });
  await fs.rm(path.join(tmpDataDir, "app.db-shm"), { force: true });
});

const FULL_HEADERS = ["Company", "Contact Name", "Designation", "Role Category", "Email", "Mobile / Phone", "City", "State", "Industry", "Source File"];
const FULL_FIELD_COLUMNS: Record<CanonicalField, number | null> = {
  company: 0,
  contactName: 1,
  designation: 2,
  roleCategory: 3,
  email: 4,
  phone: 5,
  city: 6,
  state: 7,
  industry: 8,
  sourceFile: 9,
};

// Writes a real .xlsx file to disk and returns only its path — computePreview/
// commitImport now take file location refs (storedPath/originalFilename),
// not a pre-parsed in-memory Workbook, since both stream the file themselves
// (see parseWorkbook.ts's streaming functions). Every test in this file
// therefore genuinely exercises the streaming read path, not a mock of it.
async function buildWorkbookFile(sheetName: string, headers: string[], rows: (string | number | null)[][]): Promise<{ path: string }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  const filePath = path.join(tmpFilesDir, `${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(filePath);
  return { path: filePath };
}

function fileRef(filePath: string, originalFilename = "test.xlsx"): Map<string, { storedPath: string; originalFilename: string }> {
  return new Map([["file-1", { storedPath: filePath, originalFilename }]]);
}

function selection(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    fileId: "file-1",
    originalFilename: "test.xlsx",
    sheetName: "Chairmen",
    headerRowNumber: 1,
    fieldColumns: FULL_FIELD_COLUMNS,
    ...overrides,
  };
}

test("computePreview: a clean, fully-mapped sheet reports accurate counts and samples", async () => {
  const { path: filePath } = await buildWorkbookFile("Chairmen", FULL_HEADERS, [
    ["Acme Ltd", "Jane Doe", "Chairman", "Chairman", "jane@acme.com", "9999999999", "Pune", "Maharashtra", "Manufacturing", "src.xlsx"],
    ["Beta Inc", "John Smith", "Director", "Director", "john@beta.com", "8888888888", "Mumbai", "Maharashtra", "IT", "src.xlsx"],
  ]);
  const sel = selection({ sheetName: "Chairmen" });
  const preview = await computePreview(fileRef(filePath), [sel]);

  assert.equal(preview.totals.totalRows, 2);
  assert.equal(preview.totals.validRows, 2);
  assert.equal(preview.totals.willImportRows, 2);
  assert.equal(preview.totals.invalidRows, 0);
  assert.equal(preview.totals.duplicateExistingRows, 0);
  assert.equal(preview.sampleRecords.length, 2);
  assert.equal(preview.sampleRecords[0].fullName, "Jane Doe");
});

test("computePreview: a row with no contact name is invalid and excluded from willImportRows", async () => {
  const { path: filePath } = await buildWorkbookFile("Sheet1", FULL_HEADERS, [
    ["Acme Ltd", "", "Chairman", "Chairman", "jane@acme.com", "9999999999", "Pune", "Maharashtra", "Manufacturing", "src.xlsx"],
    ["Beta Inc", "John Smith", "Director", "Director", "john@beta.com", "8888888888", "Mumbai", "Maharashtra", "IT", "src.xlsx"],
  ]);
  const preview = await computePreview(fileRef(filePath), [selection({ sheetName: "Sheet1" })]);

  assert.equal(preview.totals.totalRows, 2);
  assert.equal(preview.totals.invalidRows, 1);
  assert.equal(preview.totals.willImportRows, 1);
  assert.equal(preview.sampleErrors.length, 1);
  assert.equal(preview.sampleErrors[0].reason, "Missing contact name");
});

test("computePreview: duplicate rows within the same file are detected and not double counted as willImportRows", async () => {
  const { path: filePath } = await buildWorkbookFile("Sheet1", FULL_HEADERS, [
    ["Acme Ltd", "Jane Doe", "Chairman", "Chairman", "jane@acme.com", "9999999999", "Pune", "Maharashtra", "Manufacturing", "src.xlsx"],
    ["Acme Ltd", "Jane Doe (dup)", "Chairman", "Chairman", "JANE@ACME.COM", "9999999999", "Pune", "Maharashtra", "Manufacturing", "src.xlsx"],
  ]);
  const preview = await computePreview(fileRef(filePath), [selection({ sheetName: "Sheet1" })]);

  assert.equal(preview.totals.validRows, 2);
  assert.equal(preview.totals.duplicateInFileRows, 1, "same email (case-insensitive) on a later row is an intra-file duplicate");
  assert.equal(preview.totals.willImportRows, 1);
});

test("computePreview: rows matching an already-existing lead are reported as existing duplicates, not new", async () => {
  await leadsRepository.bulkCreate([
    {
      source: "manual",
      sourceId: "manual-1",
      dedupKey: "email:jane@acme.com",
      email: "jane@acme.com",
      fullName: "Jane Doe",
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
    },
  ]);

  const { path: filePath } = await buildWorkbookFile("Sheet1", FULL_HEADERS, [
    ["Acme Ltd", "Jane Doe", "Chairman", "Chairman", "jane@acme.com", "9999999999", "Pune", "Maharashtra", "Manufacturing", "src.xlsx"],
  ]);
  const preview = await computePreview(fileRef(filePath), [selection({ sheetName: "Sheet1" })]);

  assert.equal(preview.totals.duplicateExistingRows, 1);
  assert.equal(preview.totals.willImportRows, 0);
});

test("computePreview: an unmapped (blank-by-decision) canonical field is tracked in blankFieldCounts without invalidating rows", async () => {
  const headersNoPhone = ["Company", "Contact Name", "Email"];
  const mapping: Record<CanonicalField, number | null> = {
    company: 0,
    contactName: 1,
    designation: null,
    roleCategory: null,
    email: 2,
    phone: null, // user chose "leave blank" for the missing Mobile/Phone column
    city: null,
    state: null,
    industry: null,
    sourceFile: null,
  };
  const { path: filePath } = await buildWorkbookFile("Sheet1", headersNoPhone, [["Acme Ltd", "Jane Doe", "jane@acme.com"]]);
  const preview = await computePreview(fileRef(filePath), [selection({ sheetName: "Sheet1", fieldColumns: mapping })]);

  assert.equal(preview.totals.validRows, 1);
  assert.equal(preview.totals.willImportRows, 1);
  assert.equal(preview.sheets[0].blankFieldCounts.phone, 1);
});

test("commitImport: writes only the valid, non-duplicate rows as leads with import provenance, and skips/reports the rest", async () => {
  const { path: filePath } = await buildWorkbookFile("Directors", FULL_HEADERS, [
    ["Acme Ltd", "Jane Doe", "Managing Director", "Director", "jane@acme.com", "9999999999", "Pune", "Maharashtra", "Manufacturing", "Company Director 1.xlsx"],
    ["Beta Inc", "", "Director", "Director", "beta@beta.com", "8888888888", "Mumbai", "Maharashtra", "IT", "Company Director 1.xlsx"], // invalid: no name
  ]);
  const sel = selection({ sheetName: "Directors" });
  const result = await commitImport(fileRef(filePath), [sel]);

  assert.equal(result.imported, 1);
  assert.equal(result.invalidRows, 1);
  assert.equal(result.skippedDuplicates, 0);
  assert.equal(result.aborted, false);
  assert.equal(result.errorRows.length, 1);
  assert.equal(result.errorRows[0].reason, "Missing contact name");

  const leads = await leadsRepository.list();
  assert.equal(leads.length, 1);
  const lead = leads[0];
  assert.equal(lead.source, "import");
  assert.equal(lead.fullName, "Jane Doe");
  assert.equal(lead.company, "Acme Ltd");
  assert.equal(lead.roleCategory, "Director");
  assert.equal(lead.industry, "Manufacturing");
  assert.equal(lead.sourceFile, "Company Director 1.xlsx");
  assert.equal(lead.sourceWorksheet, "Directors");
  assert.equal(lead.status, "new");
  assert.equal(lead.automationEnabled, true, "imported leads are not auto-excluded from later manual automation, same as any other source");
});

test("commitImport: re-committing the identical file/sheet is idempotent — everything resolves as an existing duplicate, nothing is overwritten", async () => {
  const { path: filePath } = await buildWorkbookFile("Directors", FULL_HEADERS, [
    ["Acme Ltd", "Jane Doe", "Managing Director", "Director", "jane@acme.com", "9999999999", "Pune", "Maharashtra", "Manufacturing", "src.xlsx"],
  ]);
  const sel = selection({ sheetName: "Directors", originalFilename: "same-file.xlsx" });

  const first = await commitImport(fileRef(filePath, "same-file.xlsx"), [sel]);
  assert.equal(first.imported, 1);

  const second = await commitImport(fileRef(filePath, "same-file.xlsx"), [sel]);
  assert.equal(second.imported, 0);
  assert.equal(second.skippedDuplicates, 1);

  const leads = await leadsRepository.list();
  assert.equal(leads.length, 1, "no duplicate lead was created on re-import");
});

test("commitImport: a row with no email deterministically dedupes against itself on re-import via sourceId, not just email", async () => {
  const headersNoEmail = ["Company", "Contact Name"];
  const mapping: Record<CanonicalField, number | null> = {
    company: 0,
    contactName: 1,
    designation: null,
    roleCategory: null,
    email: null,
    phone: null,
    city: null,
    state: null,
    industry: null,
    sourceFile: null,
  };
  const { path: filePath } = await buildWorkbookFile("NoEmailSheet", headersNoEmail, [["Acme Ltd", "No Email Guy"]]);
  const sel = selection({ sheetName: "NoEmailSheet", originalFilename: "no-email.xlsx", fieldColumns: mapping });

  const first = await commitImport(fileRef(filePath, "no-email.xlsx"), [sel]);
  assert.equal(first.imported, 1);

  const second = await commitImport(fileRef(filePath, "no-email.xlsx"), [sel]);
  assert.equal(second.imported, 0);
  assert.equal(second.skippedDuplicates, 1);
});

test("commitImport: never touches leads created by other sources (Apollo/manual) — no cross-source overwrite", async () => {
  const { inserted } = await leadsRepository.bulkCreate([
    {
      source: "apollo",
      sourceId: "apollo-1",
      dedupKey: "email:jane@acme.com",
      email: "jane@acme.com",
      fullName: "Original Apollo Name",
      title: "Original Title",
      company: "Original Co",
      companyDomain: "acme.com",
      linkedinUrl: null,
      phone: null,
      location: null,
      icpProfileId: null,
      searchRunId: null,
      raw: { apollo: true },
      roleCategory: null,
      industry: null,
      sourceFile: null,
      sourceWorksheet: null,
    },
  ]);
  const original = inserted[0];

  const { path: filePath } = await buildWorkbookFile("Sheet1", FULL_HEADERS, [
    ["Different Co", "Different Name", "Chairman", "Chairman", "jane@acme.com", "111", "Pune", "MH", "Manufacturing", "src.xlsx"],
  ]);
  const result = await commitImport(fileRef(filePath), [selection({ sheetName: "Sheet1" })]);

  assert.equal(result.imported, 0);
  assert.equal(result.skippedDuplicates, 1);

  const leads = await leadsRepository.list();
  assert.equal(leads.length, 1);
  assert.deepEqual(leads[0], original, "the pre-existing Apollo lead is completely untouched");
});

// Regression guard for an upstream ExcelJS 4.4.0 bug: its streaming reader
// (lib/stream/xlsx/workbook-reader.js, _parseWorksheet) dereferences
// `this.model.sheets` without checking `this.model` is set yet, which throws
// for certain zip entry orderings a file can legitimately have (confirmed
// NOT reachable for the real production workbook — its entry order forces
// ExcelJS's own safe deferred-parsing path for every sheet — but repeatedly
// reproducible, ~65% of attempts, when writing/reading small fixtures like
// the ones this test suite generates). iterateFileRows (importPipeline.ts)
// catches this specific failure and falls back to the original in-memory
// reader for whatever wasn't streamed yet. This isn't deterministically
// triggerable without hand-crafting a malformed zip, so this test instead
// statistically exercises the real streaming + fallback path many times in
// a row — the same shape of repeated write/stream-read cycle that exposed
// the bug in the first place — and requires every single one to still
// produce correct results.
test("computePreview: streaming a freshly-written workbook repeatedly never produces incorrect totals (statistical regression guard for the ExcelJS streaming-reader race + fallback)", async () => {
  const ATTEMPTS = 15;
  for (let i = 0; i < ATTEMPTS; i++) {
    const { path: filePath } = await buildWorkbookFile("Sheet1", FULL_HEADERS, [
      ["Acme Ltd", "Jane Doe", "Chairman", "Chairman", `jane${i}@acme.com`, "9999999999", "Pune", "Maharashtra", "Manufacturing", "src.xlsx"],
      ["Beta Inc", "", "Director", "Director", `beta${i}@beta.com`, "8888888888", "Mumbai", "Maharashtra", "IT", "src.xlsx"], // invalid: no name
    ]);
    const preview = await computePreview(fileRef(filePath), [selection({ sheetName: "Sheet1" })]);
    assert.equal(preview.totals.totalRows, 2, `attempt ${i}: totalRows`);
    assert.equal(preview.totals.validRows, 1, `attempt ${i}: validRows`);
    assert.equal(preview.totals.invalidRows, 1, `attempt ${i}: invalidRows`);
    assert.equal(preview.totals.willImportRows, 1, `attempt ${i}: willImportRows`);
    assert.equal(preview.sampleRecords[0]?.fullName, "Jane Doe", `attempt ${i}: sample record`);
  }
});

test("computeSelectionsDigest: identical selections produce the same digest; any mapping change produces a different one", () => {
  const a = [selection()];
  const b = [selection()];
  const c = [selection({ fieldColumns: { ...FULL_FIELD_COLUMNS, phone: null } })];

  assert.equal(computeSelectionsDigest(a), computeSelectionsDigest(b));
  assert.notEqual(computeSelectionsDigest(a), computeSelectionsDigest(c));
});
