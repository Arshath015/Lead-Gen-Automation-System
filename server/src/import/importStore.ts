import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorksheetSummary } from "./parseWorkbook";
import type { ColumnMapping, ImportPreviewSummary, ImportErrorRow } from "./importPipeline";

// Where uploaded files are staged while the user works through the
// upload -> map -> preview -> commit wizard. Deliberately never under
// server/data (that's leadsRepository's collection-store directory) — this
// is scratch space for in-flight uploads only, nothing here is ever read by
// jsonStore. Overridable so tests can redirect it to a throwaway temp dir,
// same convention as DATA_DIR in db/jsonStore.ts.
const IMPORT_TMP_ROOT = process.env.IMPORT_TMP_DIR
  ? path.resolve(process.env.IMPORT_TMP_DIR)
  : path.join(os.tmpdir(), "stampsize-imports");

// Staged uploads older than this are swept on the next createStaging() call —
// generous enough that a user mid-wizard on a large file's preview never
// loses their upload, short enough that abandoned uploads don't accumulate
// on disk indefinitely.
const STAGING_TTL_MS = 60 * 60 * 1000;

export interface StagingFile {
  fileId: string;
  originalFilename: string;
  storedPath: string;
  worksheets: WorksheetSummary[];
}

export interface StagingPreview {
  digest: string;
  selections: ColumnMapping[];
  summary: ImportPreviewSummary;
}

export interface StagingRecord {
  stagingId: string;
  createdAt: number;
  dir: string;
  files: StagingFile[];
  lastPreview: StagingPreview | null;
  errorReport: ImportErrorRow[] | null;
}

const stagings = new Map<string, StagingRecord>();

async function ensureRoot(): Promise<void> {
  await fs.mkdir(IMPORT_TMP_ROOT, { recursive: true });
}

async function sweepExpired(): Promise<void> {
  const now = Date.now();
  for (const [id, record] of stagings) {
    if (now - record.createdAt > STAGING_TTL_MS) {
      stagings.delete(id);
      await fs.rm(record.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function createStaging(): Promise<StagingRecord> {
  await ensureRoot();
  await sweepExpired();
  const stagingId = randomUUID();
  const dir = path.join(IMPORT_TMP_ROOT, stagingId);
  await fs.mkdir(dir, { recursive: true });
  const record: StagingRecord = { stagingId, createdAt: Date.now(), dir, files: [], lastPreview: null, errorReport: null };
  stagings.set(stagingId, record);
  return record;
}

export function getStaging(stagingId: string): StagingRecord | null {
  return stagings.get(stagingId) ?? null;
}

// Absolute path an uploaded file for this staging should be written to.
// Uses a fresh random name (never the user-supplied filename) so a
// maliciously crafted original filename (path traversal, reserved names)
// can never influence where on disk the file actually lands — the real
// filename is kept only as metadata (StagingFile.originalFilename).
export function stagingFilePath(record: StagingRecord, originalFilename: string): { fileId: string; storedPath: string } {
  const fileId = randomUUID();
  const ext = path.extname(originalFilename).toLowerCase();
  return { fileId, storedPath: path.join(record.dir, `${fileId}${ext}`) };
}

export async function deleteStaging(stagingId: string): Promise<boolean> {
  const record = stagings.get(stagingId);
  if (!record) return false;
  stagings.delete(stagingId);
  await fs.rm(record.dir, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

// Test-only escape hatch: the module-level Map persists for the life of the
// process, which would otherwise leak staging records across test files
// that share a process. Not used by any production code path.
export function __resetImportStoreForTests(): void {
  stagings.clear();
}
