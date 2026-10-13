import path from "node:path";
import express, { Router } from "express";
import multer from "multer";
import { uploadErrorMessage } from "./uploadUtil";
import { isSupportedFileName, CANONICAL_FIELDS, type CanonicalField } from "../import/schema";
import { openWorkbook, summarizeWorksheets, summarizeWorksheetsStreaming, renameCsvWorksheet, WorkbookParseError } from "../import/parseWorkbook";
import { computePreview, commitImport, computeSelectionsDigest, type ColumnMapping, type ImportFileRef } from "../import/importPipeline";
import { createStaging, getStaging, deleteStaging, stagingFilePath, type StagingRecord } from "../import/importStore";

export const importRouter = Router();

// Generous enough for the real ~41MB master workbook (654k rows) plus
// headroom for future master-database refreshes, while still bounding
// worst-case abuse.
const MAX_IMPORT_FILE_BYTES = 150 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;

// --- Upload -----------------------------------------------------------

// The staging record (and its temp directory — see importStore.ts) must
// exist before multer's diskStorage can write into it, so staging creation
// happens in its own middleware ahead of multer rather than inside the
// route handler.
async function resolveStagingForUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const existingId = typeof req.query.stagingId === "string" ? req.query.stagingId : undefined;
    const record = existingId ? getStaging(existingId) : await createStaging();
    if (!record) {
      res.status(404).json({ error: "Import session not found or expired. Start a new upload." });
      return;
    }
    (req as RequestWithStaging).stagingRecord = record;
    next();
  } catch (err) {
    next(err);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, (req as RequestWithStaging).stagingRecord.dir),
    filename: (req, file, cb) => {
      const { storedPath } = stagingFilePath((req as RequestWithStaging).stagingRecord, file.originalname);
      cb(null, path.basename(storedPath));
    },
  }),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (_req, file, cb) => {
    if (!isSupportedFileName(file.originalname)) {
      cb(new Error(`Unsupported file type: "${file.originalname}". Only .xlsx and .csv are supported.`));
      return;
    }
    cb(null, true);
  },
});

export interface UploadedWorksheetDto {
  name: string;
  headerRowNumber: number | null;
  headers: string[];
  approxDataRowCount: number;
  suggestedMapping: Partial<Record<CanonicalField, number>>;
  missingFields: CanonicalField[];
  unmappedColumns: { index: number; header: string }[];
  duplicateHeaders: { header: string; indexes: number[] }[];
  importable: boolean; // false when no header row could be detected at all (e.g. a narrative/summary sheet)
}

export interface UploadedFileDto {
  fileId: string;
  originalFilename: string;
  worksheets: UploadedWorksheetDto[];
}

importRouter.post("/uploads", resolveStagingForUpload, (req, res) => {
  upload.array("files", MAX_FILES_PER_UPLOAD)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err, MAX_IMPORT_FILE_BYTES) });

    const record = (req as RequestWithStaging).stagingRecord;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "At least one file is required" });

    const results: UploadedFileDto[] = [];
    for (const file of files) {
      let worksheets;
      try {
        // .xlsx uses the bounded-memory streaming header-detector — no
        // in-memory Workbook is ever constructed for the (potentially
        // hundreds-of-thousands-of-rows) master workbook this exists for.
        // CSV keeps the original in-memory reader (ExcelJS's streaming
        // reader is .xlsx-specific, and CSV never produced the memory
        // problem this exists to fix).
        if (file.originalname.toLowerCase().endsWith(".csv")) {
          const workbook = await openWorkbook(file.path, file.originalname);
          renameCsvWorksheet(workbook, file.originalname);
          worksheets = summarizeWorksheets(workbook);
        } else {
          worksheets = await summarizeWorksheetsStreaming(file.path, file.originalname);
        }
      } catch (parseErr) {
        const message = parseErr instanceof WorkbookParseError ? parseErr.message : `Could not read "${file.originalname}"`;
        return res.status(400).json({ error: message });
      }

      const fileId = path.basename(file.filename, path.extname(file.filename));
      record.files.push({ fileId, originalFilename: file.originalname, storedPath: file.path, worksheets });

      results.push({
        fileId,
        originalFilename: file.originalname,
        worksheets: worksheets.map((w) => ({
          name: w.name,
          headerRowNumber: w.headerRowNumber,
          headers: w.headers,
          approxDataRowCount: w.approxDataRowCount,
          suggestedMapping: w.analysis?.suggestedMapping ?? {},
          missingFields: w.analysis?.missingFields ?? CANONICAL_FIELDS.map((f) => f.key),
          unmappedColumns: w.analysis?.unmappedColumns ?? [],
          duplicateHeaders: w.analysis?.duplicateHeaders ?? [],
          importable: w.headerRowNumber !== null,
        })),
      });
    }

    res.status(201).json({ stagingId: record.stagingId, files: results });
  });
});

// --- Shared helpers -----------------------------------------------------

const CANONICAL_KEYS = CANONICAL_FIELDS.map((f) => f.key);

function isValidFieldColumns(value: unknown): value is Record<CanonicalField, number | null> {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return CANONICAL_KEYS.every((key) => {
    if (!(key in obj)) return false;
    const v = obj[key];
    return v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0);
  });
}

// Re-derives the authoritative ColumnMapping for each requested selection
// from the staging record's own stored worksheet metadata — only the
// client's fieldColumns choice is trusted verbatim; sheetName/headerRowNumber
// always come from the server's own earlier parse, never the request body.
function resolveSelections(
  record: StagingRecord,
  requested: { fileId: string; sheetName: string; fieldColumns: unknown }[]
): { selections: ColumnMapping[] } | { error: string } {
  if (!Array.isArray(requested) || requested.length === 0) return { error: "selections[] is required" };

  const selections: ColumnMapping[] = [];
  for (const req of requested) {
    const file = record.files.find((f) => f.fileId === req.fileId);
    if (!file) return { error: `Unknown fileId: ${req.fileId}` };
    const sheet = file.worksheets.find((s) => s.name === req.sheetName);
    if (!sheet) return { error: `Unknown worksheet "${req.sheetName}" in ${file.originalFilename}` };
    if (sheet.headerRowNumber === null) return { error: `"${req.sheetName}" in ${file.originalFilename} has no detected header row and cannot be imported` };
    if (!isValidFieldColumns(req.fieldColumns)) {
      return { error: `Invalid column mapping for "${req.sheetName}" in ${file.originalFilename} — every canonical field must be mapped to a column index or explicitly null` };
    }
    const fieldColumns = req.fieldColumns as Record<CanonicalField, number | null>;
    for (const [key, idx] of Object.entries(fieldColumns)) {
      if (idx != null && idx >= sheet.headers.length) {
        return { error: `Column mapping for "${key}" in "${req.sheetName}" points outside the sheet's actual columns` };
      }
    }
    selections.push({
      fileId: file.fileId,
      originalFilename: file.originalFilename,
      sheetName: sheet.name,
      headerRowNumber: sheet.headerRowNumber,
      fieldColumns,
    });
  }
  return { selections };
}

// Just resolves each selected fileId to where it lives on disk — computePreview/
// commitImport do the actual (streaming, for .xlsx) reading themselves now,
// so no workbook is opened here at all.
function resolveFileRefsForSelections(record: StagingRecord, selections: ColumnMapping[]): Map<string, ImportFileRef> {
  const byFileId = new Map<string, ImportFileRef>();
  for (const sel of selections) {
    if (byFileId.has(sel.fileId)) continue;
    const file = record.files.find((f) => f.fileId === sel.fileId);
    if (!file) continue;
    byFileId.set(sel.fileId, { storedPath: file.storedPath, originalFilename: file.originalFilename });
  }
  return byFileId;
}

// --- Preview --------------------------------------------------------------

importRouter.post("/:stagingId/preview", async (req, res) => {
  const record = getStaging(req.params.stagingId);
  if (!record) return res.status(404).json({ error: "Import session not found or expired. Start a new upload." });

  const resolved = resolveSelections(record, req.body?.selections ?? []);
  if ("error" in resolved) return res.status(400).json({ error: resolved.error });

  try {
    const files = resolveFileRefsForSelections(record, resolved.selections);
    const summary = await computePreview(files, resolved.selections);
    const digest = computeSelectionsDigest(resolved.selections);
    record.lastPreview = { digest, selections: resolved.selections, summary };
    res.json({ digest, summary });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Commit -----------------------------------------------------------

importRouter.post("/:stagingId/commit", async (req, res) => {
  const record = getStaging(req.params.stagingId);
  if (!record) return res.status(404).json({ error: "Import session not found or expired. Start a new upload." });

  const { digest } = req.body ?? {};
  if (!record.lastPreview) {
    return res.status(409).json({ error: "Run preview before committing." });
  }
  if (digest !== record.lastPreview.digest) {
    return res.status(409).json({ error: "This import selection has changed since it was last previewed. Run preview again before committing." });
  }

  try {
    const files = resolveFileRefsForSelections(record, record.lastPreview.selections);
    const result = await commitImport(files, record.lastPreview.selections);
    record.errorReport = result.errorRows;
    res.json({
      imported: result.imported,
      skippedDuplicates: result.skippedDuplicates,
      invalidRows: result.invalidRows,
      failedRows: result.failedRows,
      aborted: result.aborted,
      abortReason: result.abortReason,
      errorRowCount: result.errorRows.length,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Error report + cancellation ------------------------------------------

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(","));
  return lines.join("\n");
}

importRouter.get("/:stagingId/errors.csv", (req, res) => {
  const record = getStaging(req.params.stagingId);
  if (!record || !record.errorReport) {
    return res.status(404).json({ error: "No error report available for this import session" });
  }
  const csv = toCsv(
    record.errorReport.map((e) => ({
      file: e.originalFilename,
      worksheet: e.sheetName,
      row: e.rowNumber,
      reason: e.reason,
    }))
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=import-errors.csv");
  res.send(csv);
});

importRouter.delete("/:stagingId", async (req, res) => {
  const ok = await deleteStaging(req.params.stagingId);
  if (!ok) return res.status(404).json({ error: "Import session not found or already expired" });
  res.status(204).send();
});

interface RequestWithStaging extends express.Request {
  stagingRecord: StagingRecord;
}
