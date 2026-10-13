import crypto from "node:crypto";
import { computeDedupKey } from "../normalize/leads";
import { leadsRepository } from "../db/leadsRepository";
import {
  openWorkbook,
  readDataRows,
  renameCsvWorksheet,
  iterateStreamingWorksheets,
  readDataRowsStreaming,
  isExceljsWorkbookReaderModelRace,
  type DataRow,
} from "./parseWorkbook";
import { normalizeRow, type RawCanonicalRow, type NormalizedRowFields } from "./normalizeRow";
import { CANONICAL_FIELDS, type CanonicalField } from "./schema";
import type { NewLead } from "../types/lead";

// A selected worksheet's location on disk — computePreview/commitImport take
// these instead of a pre-parsed in-memory ExcelJS.Workbook, so that reading
// a large .xlsx file happens via the bounded-memory streaming reader (see
// parseWorkbook.ts) rather than loading the whole file into JS objects up
// front. See iterateFileRows below for how a file is actually read.
export interface ImportFileRef {
  storedPath: string;
  originalFilename: string;
}

// Every lead created through this pipeline shares this source name — generic
// and file-format-agnostic (not e.g. "master_database") so any future
// worksheet or CSV file imported this same way is indistinguishable in kind,
// per the "extensible, no hardcoded single source" requirement.
export const IMPORT_SOURCE = "import";

// One selected worksheet (or CSV file, which parses as a single worksheet)
// and the user's final column-mapping decision for it. `fieldColumns`
// always has an entry for every canonical field — `null` is the user's
// explicit "leave this blank for every row" decision, never an accidental
// omission (the routes layer validates this — see import.routes.ts).
export interface ColumnMapping {
  fileId: string;
  originalFilename: string;
  sheetName: string;
  headerRowNumber: number;
  fieldColumns: Record<CanonicalField, number | null>;
}

export interface RowError {
  fileId: string;
  originalFilename: string;
  sheetName: string;
  rowNumber: number;
  reason: string;
}

export type ImportErrorRow = RowError;

export interface SheetPreviewStats {
  fileId: string;
  originalFilename: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateExistingRows: number; // collides with a lead already in the database
  duplicateInFileRows: number; // collides with another row earlier in this same import
  rowsWithInvalidEmailFormat: number;
  blankFieldCounts: Partial<Record<CanonicalField, number>>;
  willImportRows: number; // valid AND not a duplicate of any kind
}

export interface ImportPreviewSummary {
  sheets: SheetPreviewStats[];
  totals: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateExistingRows: number;
    duplicateInFileRows: number;
    rowsWithInvalidEmailFormat: number;
    willImportRows: number;
  };
  sampleRecords: NormalizedRowFields[]; // first ~20 rows that would actually be imported, across all sheets
  sampleErrors: RowError[]; // first ~50 invalid rows, for on-screen preview (the full list is only materialized at commit time)
}

export interface CommitResult {
  imported: number;
  skippedDuplicates: number;
  invalidRows: number;
  failedRows: number;
  aborted: boolean;
  abortReason: string | null;
  errorRows: ImportErrorRow[];
}

const SAMPLE_RECORD_CAP = 20;
const SAMPLE_ERROR_CAP = 50;
const COMMIT_BATCH_SIZE = 500;

// Deterministic (not random) so re-importing the exact same file/sheet/row
// twice produces the same sourceId, and therefore — via computeDedupKey's
// source:sourceId fallback — the same dedupKey. That's what makes a re-run
// of an unchanged import file correctly resolve as "already imported"
// instead of creating duplicates, even for rows with no email at all (which
// is the only case where that fallback path is ever reached).
export function computeImportSourceId(params: { originalFilename: string; sheetName: string; rowNumber: number }): string {
  const raw = `${params.originalFilename}::${params.sheetName}::${params.rowNumber}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function extractRawRow(cells: (string | null)[], fieldColumns: Record<CanonicalField, number | null>): RawCanonicalRow {
  const get = (key: CanonicalField): string | null => {
    const idx = fieldColumns[key];
    return idx == null ? null : (cells[idx] ?? null);
  };
  return {
    company: get("company"),
    contactName: get("contactName"),
    designation: get("designation"),
    roleCategory: get("roleCategory"),
    email: get("email"),
    phone: get("phone"),
    city: get("city"),
    state: get("state"),
    industry: get("industry"),
    sourceFile: get("sourceFile"),
  };
}

export function buildNewLead(
  fields: NormalizedRowFields,
  ctx: { originalFilename: string; sheetName: string; rowNumber: number }
): NewLead {
  const sourceId = computeImportSourceId(ctx);
  const dedupKey = computeDedupKey({
    source: IMPORT_SOURCE,
    sourceId,
    email: fields.email,
    companyDomain: null,
    fullName: fields.fullName as string, // caller only reaches here for valid (fullName != null) rows
  });
  return {
    source: IMPORT_SOURCE,
    sourceId,
    dedupKey,
    email: fields.email,
    fullName: fields.fullName as string,
    title: fields.title,
    company: fields.company,
    companyDomain: null,
    linkedinUrl: null,
    phone: fields.phone,
    location: fields.location,
    icpProfileId: null,
    searchRunId: null,
    raw: { importedFrom: ctx.originalFilename, sheetName: ctx.sheetName, rowNumber: ctx.rowNumber, emailValid: fields.emailValid },
    roleCategory: fields.roleCategory,
    industry: fields.industry,
    sourceFile: fields.sourceFile,
    sourceWorksheet: ctx.sheetName,
  };
}

function emptyBlankFieldCounts(): Partial<Record<CanonicalField, number>> {
  const counts: Partial<Record<CanonicalField, number>> = {};
  for (const f of CANONICAL_FIELDS) counts[f.key] = 0;
  return counts;
}

// Briefly yields to the event loop so a large (hundreds-of-thousands-of-row)
// sheet's synchronous per-row work never blocks other requests this
// single-process server needs to keep handling (health checks, other users'
// API calls) for the whole duration of a preview/commit pass.
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
const YIELD_EVERY_N_ROWS = 500;

type RowOutcome =
  | { kind: "invalid"; rowNumber: number; reason: string }
  | { kind: "duplicate_existing"; rowNumber: number; fields: NormalizedRowFields }
  | { kind: "duplicate_in_file"; rowNumber: number; fields: NormalizedRowFields }
  | { kind: "new"; rowNumber: number; fields: NormalizedRowFields; newLead: NewLead };

function columnCountFor(selection: ColumnMapping): number {
  return Object.values(selection.fieldColumns).reduce<number>((max, idx) => (idx != null ? Math.max(max, idx + 1) : max), 0);
}

function classifyRow(
  selection: ColumnMapping,
  { rowNumber, cells }: DataRow,
  existingDedupKeys: Set<string> | null,
  seenInFileDedupKeys: Set<string>
): RowOutcome {
  const raw = extractRawRow(cells, selection.fieldColumns);
  const { fields, valid, invalidReason } = normalizeRow(raw);

  if (!valid) return { kind: "invalid", rowNumber, reason: invalidReason as string };

  const newLead = buildNewLead(fields, { originalFilename: selection.originalFilename, sheetName: selection.sheetName, rowNumber });
  if (seenInFileDedupKeys.has(newLead.dedupKey)) return { kind: "duplicate_in_file", rowNumber, fields };
  if (existingDedupKeys?.has(newLead.dedupKey)) return { kind: "duplicate_existing", rowNumber, fields };
  seenInFileDedupKeys.add(newLead.dedupKey);
  return { kind: "new", rowNumber, fields, newLead };
}

// Shared by the CSV path and the XLSX streaming-race fallback below — both
// ultimately read via the original in-memory ExcelJS.Workbook model, just
// for different reasons (CSV always; XLSX only as a last resort). CSV
// worksheets need the generic "Sheet1" name replaced with something
// meaningful (see renameCsvWorksheet's own comment); an XLSX file already
// has its real sheet names and must NOT have its first worksheet renamed.
async function* iterateInMemoryFileRows(
  file: ImportFileRef,
  selectionsForFile: ColumnMapping[],
  existingDedupKeys: Set<string> | null,
  seenInFileDedupKeys: Set<string>
): AsyncGenerator<{ selection: ColumnMapping; outcome: RowOutcome }> {
  const workbook = await openWorkbook(file.storedPath, file.originalFilename);
  if (file.originalFilename.toLowerCase().endsWith(".csv")) renameCsvWorksheet(workbook, file.originalFilename);
  let i = 0;
  for (const selection of selectionsForFile) {
    const worksheet = workbook.getWorksheet(selection.sheetName);
    if (!worksheet) continue;
    for (const dataRow of readDataRows(worksheet, selection.headerRowNumber, columnCountFor(selection))) {
      yield { selection, outcome: classifyRow(selection, dataRow, existingDedupKeys, seenInFileDedupKeys) };
      i += 1;
      if (i % YIELD_EVERY_N_ROWS === 0) await yieldToEventLoop();
    }
  }
}

// Reads exactly ONE selected file, in a SINGLE pass, dispatching each row to
// whichever of that file's selections matches the worksheet it came from —
// never re-opening/re-reading the file once per selected sheet. For .xlsx
// this streams (see parseWorkbook.ts's streaming functions): worksheets not
// in `selectionsForFile` are never read at all (the streaming reader
// autodrains them for free), and a selected worksheet's rows are processed
// and discarded one at a time, so memory stays bounded regardless of the
// file's total row count. CSV keeps using the original in-memory reader —
// ExcelJS's streaming reader is .xlsx-specific, and CSV's simpler format
// never produced the memory problem this exists to fix.
//
// If the streaming reader hits the upstream ExcelJS race documented on
// isExceljsWorkbookReaderModelRace (parseWorkbook.ts), this falls back to
// the original in-memory reader — but ONLY for whichever selections of this
// file haven't already had their rows yielded yet, never re-processing (and
// so never double-counting/double-yielding) a sheet that already streamed
// through successfully.
async function* iterateFileRows(
  file: ImportFileRef,
  selectionsForFile: ColumnMapping[],
  existingDedupKeys: Set<string> | null,
  seenInFileDedupKeys: Set<string>
): AsyncGenerator<{ selection: ColumnMapping; outcome: RowOutcome }> {
  if (file.originalFilename.toLowerCase().endsWith(".csv")) {
    yield* iterateInMemoryFileRows(file, selectionsForFile, existingDedupKeys, seenInFileDedupKeys);
    return;
  }

  const selectionsByName = new Map(selectionsForFile.map((s) => [s.sheetName, s]));
  const remaining = new Set(selectionsForFile.map((s) => s.sheetName));
  let i = 0;

  try {
    for await (const { name, reader } of iterateStreamingWorksheets(file.storedPath)) {
      const selection = selectionsByName.get(name);
      if (!selection) continue; // not selected — never consumed, so the reader autodrains this sheet's XML instead of parsing it
      for await (const dataRow of readDataRowsStreaming(reader, selection.headerRowNumber, columnCountFor(selection))) {
        yield { selection, outcome: classifyRow(selection, dataRow, existingDedupKeys, seenInFileDedupKeys) };
        i += 1;
        if (i % YIELD_EVERY_N_ROWS === 0) await yieldToEventLoop();
      }
      remaining.delete(name); // this sheet's rows are all yielded — a later failure must never re-yield them
    }
  } catch (err) {
    if (!isExceljsWorkbookReaderModelRace(err)) throw err;
    const fallbackSelections = selectionsForFile.filter((s) => remaining.has(s.sheetName));
    if (fallbackSelections.length === 0) return; // the race hit on a sheet nobody selected (or after everything selected already streamed) — nothing left to recover
    yield* iterateInMemoryFileRows(file, fallbackSelections, existingDedupKeys, seenInFileDedupKeys);
  }
}

// Groups selections by fileId (preserving each file's own selection list,
// in original order) and reads every file exactly once via iterateFileRows,
// yielding rows in file-then-worksheet-encounter order — NOT necessarily the
// order `selections` was originally given in, since that can interleave
// multiple files/sheets arbitrarily. Callers that need per-selection stats
// in the original order (both computePreview and commitImport do) key their
// own accumulator by selection instead of relying on yield order.
async function* iterateAllSelectedRows(
  filesByFileId: Map<string, ImportFileRef>,
  selections: ColumnMapping[],
  existingDedupKeys: Set<string> | null,
  seenInFileDedupKeys: Set<string>
): AsyncGenerator<{ selection: ColumnMapping; outcome: RowOutcome }> {
  const selectionsByFile = new Map<string, ColumnMapping[]>();
  for (const s of selections) {
    const list = selectionsByFile.get(s.fileId) ?? [];
    list.push(s);
    selectionsByFile.set(s.fileId, list);
  }
  for (const [fileId, selectionsForFile] of selectionsByFile) {
    const file = filesByFileId.get(fileId);
    if (!file) continue;
    yield* iterateFileRows(file, selectionsForFile, existingDedupKeys, seenInFileDedupKeys);
  }
}

export async function computePreview(
  filesByFileId: Map<string, ImportFileRef>,
  selections: ColumnMapping[]
): Promise<ImportPreviewSummary> {
  const existingLeads = await leadsRepository.list();
  const existingDedupKeys = new Set(existingLeads.map((l) => l.dedupKey));
  const seenInFileDedupKeys = new Set<string>();

  // Pre-seed one stats bucket per selection, in the ORIGINAL selections
  // order — rows arrive grouped by file-then-worksheet-encounter order
  // (iterateAllSelectedRows), which can differ from this, so results are
  // looked up by selection identity rather than relying on arrival order.
  const statsBySelection = new Map<ColumnMapping, SheetPreviewStats>();
  for (const selection of selections) {
    statsBySelection.set(selection, {
      fileId: selection.fileId,
      originalFilename: selection.originalFilename,
      sheetName: selection.sheetName,
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      duplicateExistingRows: 0,
      duplicateInFileRows: 0,
      rowsWithInvalidEmailFormat: 0,
      blankFieldCounts: emptyBlankFieldCounts(),
      willImportRows: 0,
    });
  }

  const sampleRecords: NormalizedRowFields[] = [];
  const sampleErrors: RowError[] = [];

  for await (const { selection, outcome } of iterateAllSelectedRows(filesByFileId, selections, existingDedupKeys, seenInFileDedupKeys)) {
    const stats = statsBySelection.get(selection)!;
    stats.totalRows += 1;
    if (outcome.kind === "invalid") {
      stats.invalidRows += 1;
      if (sampleErrors.length < SAMPLE_ERROR_CAP) {
        sampleErrors.push({
          fileId: selection.fileId,
          originalFilename: selection.originalFilename,
          sheetName: selection.sheetName,
          rowNumber: outcome.rowNumber,
          reason: outcome.reason,
        });
      }
      continue;
    }

    stats.validRows += 1;
    if (!outcome.fields.emailValid) stats.rowsWithInvalidEmailFormat += 1;
    for (const key of Object.keys(stats.blankFieldCounts) as CanonicalField[]) {
      if (outcome.fields[key as keyof NormalizedRowFields] === null) {
        stats.blankFieldCounts[key] = (stats.blankFieldCounts[key] ?? 0) + 1;
      }
    }

    if (outcome.kind === "duplicate_existing") {
      stats.duplicateExistingRows += 1;
    } else if (outcome.kind === "duplicate_in_file") {
      stats.duplicateInFileRows += 1;
    } else {
      stats.willImportRows += 1;
      if (sampleRecords.length < SAMPLE_RECORD_CAP) sampleRecords.push(outcome.fields);
    }
  }

  const sheets = selections.map((s) => statsBySelection.get(s)!);

  const totals = sheets.reduce(
    (acc, s) => ({
      totalRows: acc.totalRows + s.totalRows,
      validRows: acc.validRows + s.validRows,
      invalidRows: acc.invalidRows + s.invalidRows,
      duplicateExistingRows: acc.duplicateExistingRows + s.duplicateExistingRows,
      duplicateInFileRows: acc.duplicateInFileRows + s.duplicateInFileRows,
      rowsWithInvalidEmailFormat: acc.rowsWithInvalidEmailFormat + s.rowsWithInvalidEmailFormat,
      willImportRows: acc.willImportRows + s.willImportRows,
    }),
    { totalRows: 0, validRows: 0, invalidRows: 0, duplicateExistingRows: 0, duplicateInFileRows: 0, rowsWithInvalidEmailFormat: 0, willImportRows: 0 }
  );

  return { sheets, totals, sampleRecords, sampleErrors };
}

// digest identifies exactly which selections (files/sheets/column mapping)
// a preview was computed for, so commit() can refuse to run against a
// mapping the caller never actually previewed and confirmed.
export function computeSelectionsDigest(selections: ColumnMapping[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(selections)).digest("hex");
}

export async function commitImport(
  filesByFileId: Map<string, ImportFileRef>,
  selections: ColumnMapping[]
): Promise<CommitResult> {
  const existingLeads = await leadsRepository.list();
  const existingDedupKeys = new Set(existingLeads.map((l) => l.dedupKey));
  const seenInFileDedupKeys = new Set<string>();

  const result: CommitResult = {
    imported: 0,
    skippedDuplicates: 0,
    invalidRows: 0,
    failedRows: 0,
    aborted: false,
    abortReason: null,
    errorRows: [],
  };

  let batch: NewLead[] = [];
  let batchMeta: { fileId: string; originalFilename: string; sheetName: string; rowNumber: number }[] = [];

  async function flushBatch(): Promise<boolean> {
    if (batch.length === 0) return true;
    try {
      const { inserted, skippedDuplicates } = await leadsRepository.bulkCreate(batch);
      result.imported += inserted.length;
      result.skippedDuplicates += skippedDuplicates;
      batch = [];
      batchMeta = [];
      return true;
    } catch (err) {
      // A batch write failure stops the commit here rather than silently
      // continuing — everything already flushed in prior batches stays
      // committed (each bulkCreate call is its own durable write), but
      // nothing from this batch or any later one is attempted.
      result.aborted = true;
      result.abortReason = `Import stopped: ${(err as Error).message}. Rows already imported before this point remain saved; nothing after it was written.`;
      result.failedRows += batch.length;
      for (const meta of batchMeta) {
        result.errorRows.push({ ...meta, reason: "Not imported — the batch containing this row failed to write" });
      }
      batch = [];
      batchMeta = [];
      return false;
    }
  }

  for await (const { selection, outcome } of iterateAllSelectedRows(filesByFileId, selections, existingDedupKeys, seenInFileDedupKeys)) {
    if (outcome.kind === "invalid") {
      result.invalidRows += 1;
      result.errorRows.push({
        fileId: selection.fileId,
        originalFilename: selection.originalFilename,
        sheetName: selection.sheetName,
        rowNumber: outcome.rowNumber,
        reason: outcome.reason,
      });
      continue;
    }
    if (outcome.kind === "duplicate_existing" || outcome.kind === "duplicate_in_file") {
      result.skippedDuplicates += 1;
      continue;
    }

    batch.push(outcome.newLead);
    batchMeta.push({
      fileId: selection.fileId,
      originalFilename: selection.originalFilename,
      sheetName: selection.sheetName,
      rowNumber: outcome.rowNumber,
    });
    if (batch.length >= COMMIT_BATCH_SIZE) {
      const ok = await flushBatch();
      if (!ok) break;
    }
  }

  if (!result.aborted) await flushBatch();

  return result;
}
