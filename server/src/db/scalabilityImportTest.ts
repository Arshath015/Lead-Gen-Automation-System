// Controlled scalability test for the streaming import refactor (see
// ../import/parseWorkbook.ts's streaming functions). Generates a SYNTHETIC
// workbook that mirrors the real production master workbook's scale — 8
// sheets, ~654K total rows, same 10-column layout — and measures memory and
// timing for the upload (header-detection) and preview (full row streaming)
// phases, the same two phases that previously measured ~3.4GB of process
// memory on the real 41MB file with the old full-in-memory ExcelJS reader.
//
// Deliberately does NOT touch the real production workbook or any real
// database — this generates its own throwaway file in a temp directory and
// runs computePreview against an isolated in-memory-only selection; nothing
// here writes to server/data or creates any leads.
//
// Usage: npx tsx --expose-gc src/db/scalabilityImportTest.ts
// (--expose-gc is optional but makes the memory deltas between phases much
// more meaningful by forcing a collection before each snapshot instead of
// measuring whatever garbage happened to still be pending.)

import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { summarizeWorksheetsStreaming } from "../import/parseWorkbook";
import { computePreview, type ColumnMapping, type ImportFileRef } from "../import/importPipeline";
import type { CanonicalField } from "../import/schema";

// Mirrors Master Contact Database.xlsx's real sheet names and row counts
// (captured during the earlier production-workbook preflight), summing to
// 654,158 — the actual number this whole effort exists to safely handle.
const SHEETS: { name: string; rows: number }[] = [
  { name: "Chairmen", rows: 14803 },
  { name: "Directors", rows: 108057 },
  { name: "ManagingDirectors", rows: 32168 },
  { name: "Presidents", rows: 20941 },
  { name: "CompanySecretaries", rows: 355860 },
  { name: "CMOMarketingHeads", rows: 56767 },
  { name: "CTOITHeads", rows: 58141 },
  { name: "CEOCFOCTO", rows: 7421 },
];

const HEADERS = ["Company", "Contact Name", "Designation", "Role Category", "Email", "Mobile / Phone", "City", "State", "Industry", "Source File"];

// Streaming WRITER (not the default in-memory Workbook) — fixture
// generation is a one-time setup cost for this test, not the thing being
// measured, but there's no reason to make IT memory-heavy either when
// ExcelJS has a bounded-memory way to write a large file too.
async function generateSyntheticWorkbook(targetPath: string): Promise<void> {
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: targetPath, useStyles: false, useSharedStrings: true });
  for (let s = 0; s < SHEETS.length; s++) {
    const { name, rows } = SHEETS[s];
    const ws = writer.addWorksheet(name);
    ws.addRow(HEADERS).commit();
    for (let i = 0; i < rows; i++) {
      ws.addRow([
        `Company ${s}-${i}`,
        `Person ${s}-${i}`,
        "Director",
        "Executive",
        `person${s}_${i}@example.com`,
        "9999999999",
        "Pune",
        "Maharashtra",
        "Manufacturing",
        `Source_${s}.xlsx`,
      ]).commit();
    }
    ws.commit();
  }
  await writer.commit();
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function snapshotMemory(label: string): NodeJS.MemoryUsage {
  if (global.gc) global.gc();
  const m = process.memoryUsage();
  console.log(`[mem] ${label}: rss=${formatMB(m.rss)} heapUsed=${formatMB(m.heapUsed)} external=${formatMB(m.external)}`);
  return m;
}

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

async function main() {
  const totalRows = SHEETS.reduce((sum, s) => sum + s.rows, 0);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scalability-import-test-"));
  const filePath = path.join(tmpDir, "synthetic-large.xlsx");

  try {
    console.log(`Generating synthetic workbook: ${SHEETS.length} sheets, ${totalRows.toLocaleString()} total rows (mirrors the real production workbook's scale)...`);
    const genStart = Date.now();
    await generateSyntheticWorkbook(filePath);
    const genSeconds = (Date.now() - genStart) / 1000;
    const stat = await fs.stat(filePath);
    console.log(`Generated in ${genSeconds.toFixed(1)}s — file size ${formatMB(stat.size)}\n`);

    const baseline = snapshotMemory("baseline (after fixture generation, before upload)");

    console.log("\n=== Phase 1: Upload (streaming header detection) ===");
    const uploadStart = Date.now();
    const worksheets = await summarizeWorksheetsStreaming(filePath, "synthetic-large.xlsx");
    const uploadSeconds = (Date.now() - uploadStart) / 1000;
    const afterUpload = snapshotMemory("after upload/header-detection");
    console.log(`Upload/header-detection took ${uploadSeconds.toFixed(1)}s for ${worksheets.length} sheets`);
    console.log(
      `Memory delta vs baseline: rss +${formatMB(afterUpload.rss - baseline.rss)}, heapUsed +${formatMB(afterUpload.heapUsed - baseline.heapUsed)}`
    );
    for (const w of worksheets) {
      console.log(`  ${w.name}: headerRow=${w.headerRowNumber} approxDataRowCount=${w.approxDataRowCount.toLocaleString()}`);
    }

    console.log("\n=== Phase 2: Preview (full streaming row processing — totals, validation, dedup) ===");
    const selections: ColumnMapping[] = worksheets
      .filter((w) => w.headerRowNumber !== null)
      .map((w) => ({
        fileId: "file-1",
        originalFilename: "synthetic-large.xlsx",
        sheetName: w.name,
        headerRowNumber: w.headerRowNumber as number,
        fieldColumns: FULL_FIELD_COLUMNS,
      }));
    const files: Map<string, ImportFileRef> = new Map([["file-1", { storedPath: filePath, originalFilename: "synthetic-large.xlsx" }]]);

    const beforePreview = snapshotMemory("before preview");
    const previewStart = Date.now();
    const summary = await computePreview(files, selections);
    const previewSeconds = (Date.now() - previewStart) / 1000;
    const afterPreview = snapshotMemory("after preview");
    console.log(`Preview took ${previewSeconds.toFixed(1)}s`);
    console.log(
      `Memory delta vs before-preview: rss +${formatMB(afterPreview.rss - beforePreview.rss)}, heapUsed +${formatMB(afterPreview.heapUsed - beforePreview.heapUsed)}`
    );
    console.log(
      `Totals: totalRows=${summary.totals.totalRows.toLocaleString()} validRows=${summary.totals.validRows.toLocaleString()} willImportRows=${summary.totals.willImportRows.toLocaleString()}`
    );

    const peakRss = Math.max(baseline.rss, afterUpload.rss, beforePreview.rss, afterPreview.rss);
    console.log(`\n=== Summary ===`);
    console.log(`Peak RSS observed across both phases: ${formatMB(peakRss)}`);
    console.log(`(The OLD full-in-memory ExcelJS reader measured ~3.4GB process memory just for header detection on the real 41MB/654K-row production file.)`);
    console.log(`Rows processed: ${totalRows.toLocaleString()} (matches the real production workbook's row count)`);

    if (summary.totals.totalRows !== totalRows) {
      throw new Error(`Row count mismatch: generated ${totalRows} rows but preview reported ${summary.totals.totalRows} — streaming correctness check FAILED`);
    }
    console.log(`\nCorrectness check PASSED: every generated row was accounted for.`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Scalability test FAILED:", err);
  process.exit(1);
});
