import { useMemo, useState } from "react";
import { api } from "../../api/client";
import type { CanonicalField, ColumnMapping, ImportCommitResult, ImportPreviewSummary, UnmappedColumn, DuplicateHeader } from "../../types";
import { CANONICAL_FIELD_KEYS, isLikelyNonContactSheet } from "./canonicalFields";

export type WizardStep = "upload" | "mapping" | "summary" | "result";

export interface WorksheetState {
  name: string;
  headerRowNumber: number | null;
  headers: string[];
  approxDataRowCount: number;
  missingFields: CanonicalField[];
  unmappedColumns: UnmappedColumn[];
  duplicateHeaders: DuplicateHeader[];
  importable: boolean;
  selected: boolean;
  fieldColumns: Record<CanonicalField, number | null>;
}

export interface FileState {
  fileId: string;
  originalFilename: string;
  worksheets: WorksheetState[];
}

function buildFieldColumns(suggested: Partial<Record<CanonicalField, number>>): Record<CanonicalField, number | null> {
  const out = {} as Record<CanonicalField, number | null>;
  for (const key of CANONICAL_FIELD_KEYS) out[key] = suggested[key] ?? null;
  return out;
}

export function useImportWizard() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileState[]>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [previewDigest, setPreviewDigest] = useState<string | null>(null);
  const [previewedSignature, setPreviewedSignature] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const selections = useMemo<ColumnMapping[]>(() => {
    const sels: ColumnMapping[] = [];
    for (const f of files) {
      for (const ws of f.worksheets) {
        if (!ws.importable || !ws.selected) continue;
        sels.push({
          fileId: f.fileId,
          originalFilename: f.originalFilename,
          sheetName: ws.name,
          headerRowNumber: ws.headerRowNumber as number,
          fieldColumns: ws.fieldColumns,
        });
      }
    }
    return sels;
  }, [files]);

  const selectionsSignature = useMemo(() => JSON.stringify(selections), [selections]);
  // A mapping edit after a preview has already run invalidates that preview —
  // the backend itself refuses to commit against a stale digest (see
  // import.routes.ts's commit handler), so the UI mirrors that gate rather
  // than letting the user reach a commit call the server would 409 on.
  const isStale = preview !== null && previewedSignature !== selectionsSignature;

  async function upload(fileList: File[]) {
    setUploading(true);
    setUploadError(null);
    try {
      const res = await api.uploadImportFiles(fileList);
      setStagingId(res.stagingId);
      setFiles(
        res.files.map((dto) => ({
          fileId: dto.fileId,
          originalFilename: dto.originalFilename,
          worksheets: dto.worksheets.map((w) => ({
            name: w.name,
            headerRowNumber: w.headerRowNumber,
            headers: w.headers,
            approxDataRowCount: w.approxDataRowCount,
            missingFields: w.missingFields,
            unmappedColumns: w.unmappedColumns,
            duplicateHeaders: w.duplicateHeaders,
            importable: w.importable,
            // A sheet with zero auto-detected canonical fields (e.g. a
            // "Master Summary" metadata tab) is almost certainly not a
            // contact list — default it OFF so it's excluded from
            // selections (and therefore preview totals / commit counts)
            // without the user having to notice and deselect it manually.
            // The user can still flip it back on to map it by hand.
            selected: w.importable && !isLikelyNonContactSheet(w.missingFields),
            fieldColumns: buildFieldColumns(w.suggestedMapping),
          })),
        }))
      );
      setStep("mapping");
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function toggleWorksheet(fileId: string, sheetName: string, selected: boolean) {
    setFiles((prev) =>
      prev.map((f) =>
        f.fileId !== fileId ? f : { ...f, worksheets: f.worksheets.map((w) => (w.name !== sheetName ? w : { ...w, selected })) }
      )
    );
  }

  function updateMapping(fileId: string, sheetName: string, field: CanonicalField, columnIndex: number | null) {
    setFiles((prev) =>
      prev.map((f) =>
        f.fileId !== fileId
          ? f
          : {
              ...f,
              worksheets: f.worksheets.map((w) =>
                w.name !== sheetName ? w : { ...w, fieldColumns: { ...w.fieldColumns, [field]: columnIndex } }
              ),
            }
      )
    );
  }

  async function runPreview() {
    if (!stagingId || selections.length === 0) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await api.previewImport(stagingId, selections);
      setPreview(res.summary);
      setPreviewDigest(res.digest);
      setPreviewedSignature(selectionsSignature);
      setStep("summary");
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  function backToMapping() {
    setStep("mapping");
  }

  function requestCommit() {
    setConfirmOpen(true);
  }

  async function confirmCommit() {
    if (!stagingId || !previewDigest) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await api.commitImport(stagingId, previewDigest);
      setCommitResult(result);
      setConfirmOpen(false);
      setStep("result");
    } catch (e) {
      setCommitError((e as Error).message);
      setConfirmOpen(false);
    } finally {
      setCommitting(false);
    }
  }

  function reset() {
    setStep("upload");
    setStagingId(null);
    setFiles([]);
    setUploadError(null);
    setPreview(null);
    setPreviewDigest(null);
    setPreviewedSignature(null);
    setPreviewError(null);
    setCommitResult(null);
    setCommitError(null);
  }

  function requestCancel() {
    setCancelOpen(true);
  }

  async function confirmCancel() {
    setCancelling(true);
    try {
      if (stagingId) await api.cancelImport(stagingId).catch(() => undefined);
    } finally {
      setCancelling(false);
      setCancelOpen(false);
      reset();
    }
  }

  return {
    step,
    stagingId,
    files,
    selections,
    isStale,
    uploading,
    uploadError,
    upload,
    toggleWorksheet,
    updateMapping,
    previewing,
    previewError,
    preview,
    runPreview,
    backToMapping,
    confirmOpen,
    setConfirmOpen,
    requestCommit,
    committing,
    commitError,
    commitResult,
    confirmCommit,
    cancelOpen,
    setCancelOpen,
    requestCancel,
    cancelling,
    confirmCancel,
    reset,
  };
}

export type ImportWizard = ReturnType<typeof useImportWizard>;
