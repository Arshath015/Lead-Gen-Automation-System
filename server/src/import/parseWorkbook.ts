import ExcelJS from "exceljs";
import path from "node:path";
import { analyzeHeaders, type HeaderAnalysis } from "./schema";

export class WorkbookParseError extends Error {}

// How many leading rows we'll scan looking for the real header row — enough
// for a title/legend block like the master workbook's "Master Summary" sheet
// (which never finds a real header at all, since none of its rows have more
// than one populated text cell) without scanning the whole sheet.
const HEADER_SEARCH_ROWS = 10;
const MIN_HEADER_CELLS = 2;

export async function openWorkbook(filePath: string, originalFilename: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const lower = originalFilename.toLowerCase();
  try {
    if (lower.endsWith(".csv")) {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }
  } catch (err) {
    throw new WorkbookParseError(`Could not read "${originalFilename}" — the file may be corrupted or not a real ${lower.endsWith(".csv") ? "CSV" : "Excel"} file.`);
  }
  return workbook;
}

// Coerces one exceljs cell value (plain string/number/boolean/Date, rich
// text, hyperlink, or formula result) to plain trimmed text. Never throws —
// an unrecognized shape falls back to String(value) rather than dropping
// data silently.
export function readCellText(value: ExcelJS.CellValue): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray((value as ExcelJS.CellRichTextValue).richText)) {
      const text = (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
      return text.trim() || null;
    }
    if ("text" in value && typeof (value as ExcelJS.CellHyperlinkValue).text === "string") {
      // Hyperlink cells (e.g. a mailto: link rendered from an Email column) —
      // the visible text is the actual data; the target URL is not.
      return ((value as ExcelJS.CellHyperlinkValue).text as string).trim() || null;
    }
    if ("result" in value) {
      return readCellText((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    }
    if ("error" in value) return null; // #REF!, #N/A, etc. — no usable data
  }
  return String(value).trim() || null;
}

// Exported — the streaming functions below (and importPipeline.ts) apply
// this exact cell-reading logic to Row objects arriving one at a time from
// the streaming reader, not just the in-memory model's worksheet.getRow(n).
// Row's own interface (.getCell) is identical either way, so the same
// function works unmodified for both.
export function rowCellTexts(row: ExcelJS.Row, columnCount: number): (string | null)[] {
  const values: (string | null)[] = new Array(columnCount).fill(null);
  for (let col = 1; col <= columnCount; col++) {
    values[col - 1] = readCellText(row.getCell(col).value);
  }
  return values;
}

export function isBlankRow(values: (string | null)[]): boolean {
  return values.every((v) => v === null);
}

// The first row (within the first HEADER_SEARCH_ROWS) with at least
// MIN_HEADER_CELLS non-empty cells. A single-cell title row (like "MASTER
// CONTACT DATABASE") never qualifies, so a narrative/summary sheet like
// "Master Summary" correctly reports no header row at all rather than
// mis-detecting its legend text as column headers.
export function detectHeaderRow(worksheet: ExcelJS.Worksheet): { rowNumber: number; headers: string[] } | null {
  const scanRows = Math.min(worksheet.rowCount, HEADER_SEARCH_ROWS);
  const columnCount = Math.max(worksheet.columnCount, 1);
  for (let r = 1; r <= scanRows; r++) {
    const values = rowCellTexts(worksheet.getRow(r), columnCount);
    const nonEmptyCount = values.filter((v) => v !== null).length;
    if (nonEmptyCount >= MIN_HEADER_CELLS) {
      // Trim trailing blank columns so headers/mapping UI doesn't show phantom columns.
      let lastNonEmpty = values.length - 1;
      while (lastNonEmpty >= 0 && values[lastNonEmpty] === null) lastNonEmpty--;
      return { rowNumber: r, headers: values.slice(0, lastNonEmpty + 1).map((v) => v ?? "") };
    }
  }
  return null;
}

export interface WorksheetSummary {
  name: string;
  headerRowNumber: number | null; // null = no usable header row found (e.g. a narrative/summary sheet) — not importable
  headers: string[];
  approxDataRowCount: number; // worksheet.rowCount minus the header row; may include trailing blank rows, refined during preview
  analysis: HeaderAnalysis | null;
}

export function summarizeWorksheets(workbook: ExcelJS.Workbook): WorksheetSummary[] {
  return workbook.worksheets
    .filter((ws) => ws.state === "visible")
    .map((ws) => {
      const detected = detectHeaderRow(ws);
      if (!detected) {
        return { name: ws.name, headerRowNumber: null, headers: [], approxDataRowCount: 0, analysis: null };
      }
      return {
        name: ws.name,
        headerRowNumber: detected.rowNumber,
        headers: detected.headers,
        approxDataRowCount: Math.max(0, ws.rowCount - detected.rowNumber),
        analysis: analyzeHeaders(detected.headers),
      };
    });
}

// A CSV file loads into exceljs as one worksheet with a generic default name
// ("Sheet1") — renamed to the file's own basename so the UI shows something
// meaningful instead of an identical "Sheet1" for every uploaded CSV.
export function renameCsvWorksheet(workbook: ExcelJS.Workbook, originalFilename: string): void {
  const ws = workbook.worksheets[0];
  if (ws) ws.name = path.basename(originalFilename).replace(/\.csv$/i, "");
}

export interface DataRow {
  rowNumber: number; // 1-based row number in the original sheet, for error reporting
  cells: (string | null)[]; // aligned to the sheet's own header column order
}

// Yields every non-blank data row after the header, as plain text cells —
// synchronous (exceljs's in-memory model has no true streaming read), but
// callers iterate this lazily and should yield to the event loop
// periodically for large sheets (see importPipeline.ts).
export function* readDataRows(worksheet: ExcelJS.Worksheet, headerRowNumber: number, columnCount: number): Generator<DataRow> {
  for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
    const cells = rowCellTexts(worksheet.getRow(r), columnCount);
    if (isBlankRow(cells)) continue;
    yield { rowNumber: r, cells };
  }
}

// ===========================================================================
// Streaming (bounded-memory) reading for large .xlsx files
//
// openWorkbook()/summarizeWorksheets()/readDataRows() above all operate on
// ExcelJS's default in-memory Workbook model — workbook.xlsx.readFile()
// parses the ENTIRE file into JS objects (every row, every cell) up front,
// regardless of how much of it is actually needed. For the production
// master workbook (~41MB, ~654K rows across 8 sheets) this measured at
// ~3.4GB of process memory just to detect headers on upload — before a
// single row of preview/commit work had even started.
//
// ExcelJS also ships a genuine streaming reader
// (ExcelJS.stream.xlsx.WorkbookReader) built on a SAX parser: it yields one
// WorksheetReader per sheet as an async iterable, which itself yields one
// Row at a time as the underlying XML is parsed — no row is ever held once
// the caller has moved past it. Breaking out of a worksheet's row loop early
// (see summarizeWorksheetsStreaming below) lets the reader's own outer loop
// autodrain (cheaply discard, no further parsing) whatever of that sheet's
// XML was never consumed, which is what makes bounded-time header detection
// possible regardless of a sheet's total row count.
//
// The TypeScript definitions for WorksheetReader don't declare `.name`/
// `.state` even though the real runtime object sets them (see
// node_modules/exceljs/lib/stream/xlsx/workbook-reader.js) — this local
// interface documents the actual shape rather than casting to `any`
// everywhere it's used.
interface StreamingWorksheetReader extends AsyncIterable<ExcelJS.Row> {
  name: string;
  state?: string;
}

function openStreamingWorkbookReader(filePath: string): AsyncIterable<StreamingWorksheetReader> {
  return new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    worksheets: "emit",
    sharedStrings: "cache", // bounded by UNIQUE string count, not total cell count — see the module comment above
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "ignore",
  }) as unknown as AsyncIterable<StreamingWorksheetReader>;
}

// Same header-detection contract as detectHeaderRow (first row within
// HEADER_SEARCH_ROWS with at least MIN_HEADER_CELLS non-empty cells), but
// operating on rows arriving one at a time instead of an already-fully-
// parsed worksheet. Also tracks the highest row number seen so the caller
// can report an accurate data-row count — this does mean reading through
// every row of every worksheet (bounded MEMORY, not bounded time; see the
// module comment above), which is measured and reported in the scalability
// test this exists for (scalabilityImportTest.ts).
async function detectHeaderAndCountStreaming(
  worksheetReader: StreamingWorksheetReader
): Promise<{ headerRowNumber: number | null; headers: string[]; lastRowNumber: number }> {
  let headerRowNumber: number | null = null;
  let headers: string[] = [];
  let lastRowNumber = 0;
  let scanned = 0;

  for await (const row of worksheetReader) {
    lastRowNumber = row.number;
    if (headerRowNumber === null && scanned < HEADER_SEARCH_ROWS) {
      scanned++;
      const columnCount = Math.max(row.cellCount, 1);
      const values = rowCellTexts(row, columnCount);
      const nonEmptyCount = values.filter((v) => v !== null).length;
      if (nonEmptyCount >= MIN_HEADER_CELLS) {
        let lastNonEmpty = values.length - 1;
        while (lastNonEmpty >= 0 && values[lastNonEmpty] === null) lastNonEmpty--;
        headerRowNumber = row.number;
        headers = values.slice(0, lastNonEmpty + 1).map((v) => v ?? "");
      }
    }
  }

  return { headerRowNumber, headers, lastRowNumber };
}

// Upstream bug worked around below: ExcelJS 4.4.0's streaming reader
// (lib/stream/xlsx/workbook-reader.js, _parseWorksheet) dereferences
// `this.model.sheets` to resolve a worksheet's real name, without checking
// `this.model` is actually set yet — it's only populated once the
// xl/workbook.xml zip entry has been processed. For a file whose zip entry
// order has a worksheet appearing after xl/_rels/workbook.xml.rels and
// xl/sharedStrings.xml but before xl/workbook.xml itself, this throws
// `TypeError: Cannot read properties of undefined (reading 'sheets')`.
// Verified NOT reachable for the real production workbook (its own entry
// order puts every worksheet before workbookRels/sharedStrings/workbook.xml,
// which forces ExcelJS's own safe deferred-parsing path for every sheet),
// but reproducible — confirmed via a standalone repro script, ~65% of
// attempts — for files ExcelJS's own writer produces under some run-to-run
// non-determinism in its own output ordering, which is exactly what this
// project's test fixtures are. Exported so importPipeline.ts's row-level
// fallback (iterateFileRows) can recognize the same failure shape.
export function isExceljsWorkbookReaderModelRace(err: unknown): boolean {
  return err instanceof TypeError && /reading 'sheets'/.test(err.message);
}

// Streaming equivalent of summarizeWorksheets() — same return shape, same
// header-detection semantics, but bounded memory regardless of file size:
// no in-memory Workbook is ever constructed. CSV files are NOT handled here
// (ExcelJS's streaming reader is XLSX-specific) — callers should keep using
// openWorkbook()/summarizeWorksheets() for CSV, which is fine: CSV parsing
// is far lighter-weight than XLSX's zip+shared-strings overhead, and this
// fix targets the workbook format that actually caused the measured 3.4GB.
//
// Falls back to the original in-memory reader (whole-file, not partial —
// summarizeWorksheets() returns one complete array, so there's no partial-
// progress/double-counting hazard to manage here, unlike the row-streaming
// fallback in importPipeline.ts) if the upstream race above is hit, so an
// upload can never fail outright just because of it.
export async function summarizeWorksheetsStreaming(filePath: string, originalFilename: string): Promise<WorksheetSummary[]> {
  try {
    const summaries: WorksheetSummary[] = [];
    for await (const worksheetReader of openStreamingWorkbookReader(filePath)) {
      if (worksheetReader.state && worksheetReader.state !== "visible") continue;
      const { headerRowNumber, headers, lastRowNumber } = await detectHeaderAndCountStreaming(worksheetReader);
      if (headerRowNumber === null) {
        summaries.push({ name: worksheetReader.name, headerRowNumber: null, headers: [], approxDataRowCount: 0, analysis: null });
      } else {
        summaries.push({
          name: worksheetReader.name,
          headerRowNumber,
          headers,
          approxDataRowCount: Math.max(0, lastRowNumber - headerRowNumber),
          analysis: analyzeHeaders(headers),
        });
      }
    }
    return summaries;
  } catch (err) {
    if (!isExceljsWorkbookReaderModelRace(err)) throw err;
    const workbook = await openWorkbook(filePath, originalFilename);
    return summarizeWorksheets(workbook);
  }
}

// Iterates every worksheet of an .xlsx file as a stream, yielding each one's
// name alongside its (not-yet-consumed) row reader — the caller decides
// whether to actually read a given worksheet's rows (readDataRowsStreaming
// below) or skip it. Skipping (simply not consuming the async iterable
// before requesting the next worksheet) costs nothing extra: the reader's
// own outer loop autodrains an unconsumed sheet's remaining XML instead of
// parsing it. This is what lets computePreview/commitImport process only
// the worksheets a user actually selected, in a single pass over the file,
// without pre-loading anything.
export async function* iterateStreamingWorksheets(filePath: string): AsyncGenerator<{ name: string; reader: StreamingWorksheetReader }> {
  for await (const worksheetReader of openStreamingWorkbookReader(filePath)) {
    yield { name: worksheetReader.name, reader: worksheetReader };
  }
}

// Streaming equivalent of readDataRows() — identical contract (skips blank
// rows, yields 1-based rowNumber + cells aligned to columnCount), driven by
// a worksheet reader obtained from iterateStreamingWorksheets above instead
// of an in-memory ExcelJS.Worksheet.
export async function* readDataRowsStreaming(
  worksheetReader: StreamingWorksheetReader,
  headerRowNumber: number,
  columnCount: number
): AsyncGenerator<DataRow> {
  for await (const row of worksheetReader) {
    if (row.number <= headerRowNumber) continue;
    const cells = rowCellTexts(row, columnCount);
    if (isBlankRow(cells)) continue;
    yield { rowNumber: row.number, cells };
  }
}
