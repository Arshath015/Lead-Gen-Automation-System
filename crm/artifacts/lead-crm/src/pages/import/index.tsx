import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import Papa from "papaparse";
import {
  useAnalyzeImport,
  useValidateImport,
  useListImportJobs,
  useListImportMappingTemplates,
  useCreateImportMappingTemplate,
  useDeleteImportMappingTemplate,
  useRollbackImport,
} from "@workspace/api-client-react";
import type { ImportColumnMapping, ImportJobSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  ArrowRight, ArrowLeft, Download, Loader2, Check, RefreshCw,
  ChevronRight, Users, Save, BookOpen, Trash2, RotateCcw, Info,
} from "lucide-react";
import { format, parseISO } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type DuplicateAction = "skip" | "update" | "import_anyway";

interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  sheetNames: string[];
  selectedSheet: string;
}

interface ImportResult {
  id: number;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  updatedRows: number;
  failedRows: number;
  errors: { rowNum: number; message: string }[];
  completedAt: string;
  durationMs: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STEP_LABELS: { num: Step; label: string }[] = [
  { num: 1, label: "Upload" },
  { num: 2, label: "Analyze" },
  { num: 3, label: "Map Fields" },
  { num: 4, label: "Preview" },
  { num: 5, label: "Validate" },
  { num: 6, label: "Import" },
  { num: 7, label: "Report" },
];

const TEMPLATE_HEADERS = [
  "Sl No", "Date", "Company Name", "Poc Name", "Designation",
  "Linkedin profile link", "Contact Number", "Mail Id", "Address",
  "Remark", "Comment", "Industry", "Priority", "Lead source",
  "Website", "Deal Value", "Expected closure date",
];

const CRM_FIELD_OPTIONS = [
  { value: "__skip__", label: "— Skip this column —" },
  { value: "companyName", label: "Company Name ★" },
  { value: "contactPerson", label: "POC Name / Contact Person ★" },
  { value: "email", label: "Mail ID / Email" },
  { value: "phone", label: "Contact Number / Phone" },
  { value: "location", label: "Address / Location" },
  { value: "designation", label: "Designation / Title" },
  { value: "industry", label: "Industry / Sector" },
  { value: "remarks", label: "Remark / Notes" },
  { value: "comment", label: "Comment" },
  { value: "priority", label: "Priority (hot / warm / cold)" },
  { value: "channel", label: "Lead Source / Channel" },
  { value: "valueAmount", label: "Deal Value / Budget" },
  { value: "expectedCloseDate", label: "Expected Closure Date" },
  { value: "linkedinUrl", label: "LinkedIn Profile Link" },
  { value: "websiteUrl", label: "Website URL" },
  { value: "tags", label: "Tags / Labels" },
];

const CRM_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  CRM_FIELD_OPTIONS.filter(o => o.value !== "__skip__").map(o => [o.value, o.label.replace(" ★", "")])
);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function confidenceColor(c: number): string {
  if (c >= 80) return "bg-green-100 text-green-800 border-green-200";
  if (c >= 60) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (c > 0)  return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-500 border-gray-200";
}

function detectionLabel(method: string): string {
  switch (method) {
    case "exact": return "Exact match";
    case "synonym": return "Synonym";
    case "fuzzy": return "Fuzzy match";
    case "value_pattern": return "Value pattern";
    default: return "Not mapped";
  }
}

function applyMappingsLocally(rows: Record<string, string>[], mappings: ImportColumnMapping[]): Record<string, string>[] {
  const mappingMap = new Map(
    mappings.filter(m => m.suggestedField).map(m => [m.sourceColumn, m.suggestedField!])
  );
  return rows.map(raw => {
    const out: Record<string, string> = {};
    for (const [col, val] of Object.entries(raw)) {
      const target = mappingMap.get(col);
      if (target) out[target] = val?.trim() ?? "";
    }
    return out;
  });
}

async function streamImport(
  rows: Record<string, string>[],
  mappings: ImportColumnMapping[],
  duplicateAction: DuplicateAction,
  fileName: string,
  fileHash: string | null,
  onEvent: (ev: Record<string, unknown>) => void
): Promise<void> {
  const resp = await fetch("/api/imports/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
    credentials: "include",
    body: JSON.stringify({ rows, mappings, duplicateAction, fileName, fileHash }),
  });
  if (!resp.ok) throw new Error("Import request failed");
  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try { onEvent(JSON.parse(line.slice(6))); } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Step Indicator ─────────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center w-full mb-8 overflow-x-auto pb-1">
      {STEP_LABELS.map((s, i) => {
        const done = current > s.num;
        const active = current === s.num;
        return (
          <div key={s.num} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors border-2
                ${done ? "bg-primary border-primary text-primary-foreground"
                  : active ? "bg-primary/10 border-primary text-primary"
                  : "bg-muted border-muted-foreground/20 text-muted-foreground"}`}>
                {done ? <Check className="h-4 w-4" /> : s.num}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap hidden sm:block ${active ? "text-primary" : done ? "text-primary/70" : "text-muted-foreground"}`}>
                {s.label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1.5 transition-colors ${done ? "bg-primary" : "bg-muted-foreground/20"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Rollback Confirm Dialog ───────────────────────────────────────────────────
function RollbackDialog({
  job,
  onConfirm,
  onClose,
  loading,
}: {
  job: ImportJobSummary;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-600">Rollback Import #{job.id}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Alert>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription>
              This will permanently delete <strong>{job.importedRows} lead(s)</strong> that were created by this import
              {job.fileName ? ` ("${job.fileName}")` : ""}. This action cannot be undone.
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            Imported {format(parseISO(job.createdAt), "MMM d, yyyy 'at' h:mm a")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Yes, Rollback Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Save Template Dialog ───────────────────────────────────────────────────────
function SaveTemplateDialog({
  onSave,
  onClose,
  loading,
}: {
  onSave: (name: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Mapping Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Save the current field mappings as a reusable template for future imports with similar column structures.
          </p>
          <div className="space-y-1.5">
            <Label>Template Name</Label>
            <Input
              placeholder="e.g. Apollo Export, LinkedIn Contacts…"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && name.trim() && onSave(name.trim())}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(name.trim())} disabled={!name.trim() || loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Import Page ──────────────────────────────────────────────────────────
export default function ImportPage() {
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 / 3
  const [mappings, setMappings] = useState<ImportColumnMapping[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unknownColumns, setUnknownColumns] = useState<string[]>([]);
  const [entityHints, setEntityHints] = useState<string[]>([]);
  const [duplicateFileWarning, setDuplicateFileWarning] = useState<string | null>(null);
  const [lowConfidenceColumns, setLowConfidenceColumns] = useState<string[]>([]);

  // Template dialogs
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);

  // Step 5
  const [validation, setValidation] = useState<import("@workspace/api-client-react").ValidateImportResult | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>("skip");

  // Step 6
  const [progress, setProgress] = useState({ done: 0, total: 0, imported: 0, skipped: 0, updated: 0, failed: 0 });
  const [importing, setImporting] = useState(false);

  // Step 7
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Rollback
  const [rollbackJob, setRollbackJob] = useState<ImportJobSummary | null>(null);

  const analyzeImport = useAnalyzeImport();
  const validateImport = useValidateImport();
  const { data: historyData, refetch: refetchHistory } = useListImportJobs();
  const { data: templatesData, refetch: refetchTemplates } = useListImportMappingTemplates();
  const createTemplate = useCreateImportMappingTemplate();
  const deleteTemplate = useDeleteImportMappingTemplate();
  const rollbackImport = useRollbackImport();

  // ── File parsing ──
  const parseFile = useCallback(async (file: File) => {
    setParsing(true);
    try {
      const hash = await sha256Hex(file);
      setFileHash(hash);

      let rows: Record<string, string>[] = [];
      let sheetNames: string[] = [];
      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        sheetNames = wb.SheetNames;
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = (XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]).map(r =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))
        );
      } else {
        rows = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (res: Papa.ParseResult<Record<string, string>>) => resolve(res.data),
            error: reject,
          });
        });
      }

      if (rows.length === 0) {
        toast({ title: "Empty file", description: "The file contains no data rows.", variant: "destructive" });
        return;
      }
      setParsedFile({ headers: Object.keys(rows[0]), rows, sheetNames, selectedSheet: sheetNames[0] ?? "" });
    } catch {
      toast({ title: "Parse error", description: "Could not read the file. Ensure it's a valid CSV, XLS, or XLSX.", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }, [toast]);

  const handleFileSelect = useCallback((file: File) => parseFile(file), [parseFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleSheetChange = useCallback(async (sheetName: string) => {
    if (!parsedFile) return;
    setParsing(true);
    try {
      const file = fileInputRef.current?.files?.[0];
      if (!file) return;
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[sheetName];
      const rows = (XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]).map(r =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))
      );
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      setParsedFile(prev => prev ? { ...prev, rows, headers, selectedSheet: sheetName } : prev);
    } finally {
      setParsing(false);
    }
  }, [parsedFile]);

  // ── Step 1 → 2: Analyze ──
  const handleAnalyze = useCallback(async () => {
    if (!parsedFile) return;
    setStep(2);
    try {
      const sampleRows = parsedFile.rows.slice(0, 10);
      const result = await analyzeImport.mutateAsync({
        data: { headers: parsedFile.headers, sampleRows, totalRows: parsedFile.rows.length, fileHash },
      });
      setMappings(result.mappings);
      setWarnings(result.warnings);
      setUnknownColumns(result.unknownColumns);
      setEntityHints(result.entityExtractionHints);
      setDuplicateFileWarning(result.duplicateFileWarning ?? null);
      setLowConfidenceColumns(result.lowConfidenceColumns ?? []);
    } catch {
      toast({ title: "Analysis failed", variant: "destructive" });
      setStep(1);
    }
  }, [parsedFile, fileHash, analyzeImport, toast]);

  // ── Step 4 → 5: Validate ──
  const handleValidate = useCallback(async () => {
    if (!parsedFile) return;
    setStep(5);
    try {
      const result = await validateImport.mutateAsync({ data: { rows: parsedFile.rows, mappings } });
      setValidation(result);
    } catch {
      toast({ title: "Validation failed", variant: "destructive" });
      setStep(4);
    }
  }, [parsedFile, mappings, validateImport, toast]);

  // ── Step 5 → 6: Import ──
  const handleStartImport = useCallback(async () => {
    if (!parsedFile) return;
    setStep(6);
    setImporting(true);
    setProgress({ done: 0, total: parsedFile.rows.length, imported: 0, skipped: 0, updated: 0, failed: 0 });
    try {
      const fileName = fileInputRef.current?.files?.[0]?.name ?? "import.csv";
      await streamImport(parsedFile.rows, mappings, duplicateAction, fileName, fileHash, (ev) => {
        if (ev.type === "progress") {
          setProgress({
            done: (ev.done as number) ?? 0,
            total: (ev.total as number) ?? parsedFile.rows.length,
            imported: (ev.imported as number) ?? 0,
            skipped: (ev.skipped as number) ?? 0,
            updated: (ev.updated as number) ?? 0,
            failed: (ev.failed as number) ?? 0,
          });
        } else if (ev.type === "complete") {
          setImportResult(ev.result as ImportResult);
          setStep(7);
          refetchHistory();
        }
      });
    } catch {
      toast({ title: "Import failed", description: "An error occurred during import.", variant: "destructive" });
      setStep(5);
    } finally {
      setImporting(false);
    }
  }, [parsedFile, mappings, duplicateAction, fileHash, toast, refetchHistory]);

  // ── Template save/load ──
  const handleSaveTemplate = useCallback(async (name: string) => {
    try {
      await createTemplate.mutateAsync({ data: { name, mappings } });
      setShowSaveTemplate(false);
      refetchTemplates();
      toast({ title: "Template saved", description: `"${name}" saved and ready to reuse.` });
    } catch {
      toast({ title: "Failed to save template", variant: "destructive" });
    }
  }, [mappings, createTemplate, refetchTemplates, toast]);

  const handleLoadTemplate = useCallback((templateMappings: ImportColumnMapping[]) => {
    // Apply template: only update suggestedField for columns that exist in current file
    const templateMap = new Map(templateMappings.map(m => [m.sourceColumn, m.suggestedField]));
    setMappings(prev => prev.map(m => {
      const override = templateMap.get(m.sourceColumn);
      return override !== undefined ? { ...m, suggestedField: override } : m;
    }));
    setShowLoadTemplate(false);
    toast({ title: "Template applied", description: "Mappings updated from template. Review and adjust as needed." });
  }, [toast]);

  const handleDeleteTemplate = useCallback(async (id: number, name: string) => {
    try {
      await deleteTemplate.mutateAsync({ id });
      refetchTemplates();
      toast({ title: `"${name}" deleted` });
    } catch {
      toast({ title: "Failed to delete template", variant: "destructive" });
    }
  }, [deleteTemplate, refetchTemplates, toast]);

  // ── Rollback ──
  const handleRollback = useCallback(async () => {
    if (!rollbackJob) return;
    try {
      const result = await rollbackImport.mutateAsync({ id: rollbackJob.id });
      setRollbackJob(null);
      refetchHistory();
      toast({ title: "Import rolled back", description: `${result.deletedLeads} lead(s) deleted.` });
    } catch {
      toast({ title: "Rollback failed", variant: "destructive" });
    }
  }, [rollbackJob, rollbackImport, refetchHistory, toast]);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setStep(1);
    setParsedFile(null);
    setFileHash(null);
    setMappings([]);
    setWarnings([]);
    setUnknownColumns([]);
    setEntityHints([]);
    setDuplicateFileWarning(null);
    setLowConfidenceColumns([]);
    setValidation(null);
    setDuplicateAction("skip");
    setImportResult(null);
    setProgress({ done: 0, total: 0, imported: 0, skipped: 0, updated: 0, failed: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const downloadErrorReport = (job: ImportJobSummary) => {
    window.open(`/api/imports/${job.id}/error-report`, "_blank");
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    ws["!cols"] = TEMPLATE_HEADERS.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, "Lead_Import_Template.xlsx");
  };

  const previewRows = parsedFile ? applyMappingsLocally(parsedFile.rows.slice(0, 50), mappings) : [];
  const requiredFields = ["companyName", "contactPerson"];
  const templates = (templatesData as { templates?: import("@workspace/api-client-react").ImportMappingTemplate[] } | undefined)?.templates ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Dialogs */}
      {showSaveTemplate && (
        <SaveTemplateDialog
          onSave={handleSaveTemplate}
          onClose={() => setShowSaveTemplate(false)}
          loading={createTemplate.isPending}
        />
      )}

      {showLoadTemplate && (
        <Dialog open onOpenChange={() => setShowLoadTemplate(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Load Mapping Template</DialogTitle>
            </DialogHeader>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No saved templates yet. Complete a mapping in Step 3 and save it for future reuse.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/30 transition-colors">
                    <div>
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.mappings.length} columns · saved {format(parseISO(t.createdAt), "MMM d, yyyy")}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleLoadTemplate(t.mappings as ImportColumnMapping[])}>
                        Apply
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600"
                        onClick={() => handleDeleteTemplate(t.id, t.name)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowLoadTemplate(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {rollbackJob && (
        <RollbackDialog
          job={rollbackJob}
          onConfirm={handleRollback}
          onClose={() => setRollbackJob(null)}
          loading={rollbackImport.isPending}
        />
      )}

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Leads</h1>
        <p className="text-muted-foreground">Enterprise data ingestion with intelligent column detection, entity extraction, and full audit trail.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <StepIndicator current={step} />
          <Separator className="mb-6" />

          {/* ── STEP 1: UPLOAD ── */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold mb-1">Upload Your File</h2>
                  <p className="text-sm text-muted-foreground">Supports .csv, .xlsx, and .xls — including multi-sheet workbooks. Each file is checksummed to detect duplicates.</p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadTemplate} className="shrink-0 gap-2">
                  <Download className="h-4 w-4" />
                  Download Template
                </Button>
              </div>

              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"}`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                />
                {parsing ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Parsing file and computing checksum…</p>
                  </div>
                ) : parsedFile ? (
                  <div className="flex flex-col items-center gap-3">
                    <FileSpreadsheet className="h-10 w-10 text-primary" />
                    <div>
                      <p className="font-medium">{fileInputRef.current?.files?.[0]?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {parsedFile.rows.length.toLocaleString()} rows · {parsedFile.headers.length} columns
                        {parsedFile.sheetNames.length > 1 && ` · ${parsedFile.sheetNames.length} sheets`}
                      </p>
                      {fileHash && (
                        <p className="text-xs font-mono text-muted-foreground/60 mt-1">SHA-256: {fileHash.slice(0, 16)}…</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Drop your file here or click to browse</p>
                      <p className="text-sm text-muted-foreground mt-1">CSV, XLSX, XLS · Max 50 MB · Files are checksummed for duplicate detection</p>
                    </div>
                  </div>
                )}
              </div>

              {parsedFile && parsedFile.sheetNames.length > 1 && (
                <div className="flex items-center gap-3">
                  <Label className="whitespace-nowrap">Select worksheet:</Label>
                  <Select value={parsedFile.selectedSheet} onValueChange={handleSheetChange}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {parsedFile.sheetNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {parsedFile && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-2">
                    {parsedFile.headers.slice(0, 6).map(h => (
                      <Badge key={h} variant="secondary" className="font-mono text-xs">{h}</Badge>
                    ))}
                    {parsedFile.headers.length > 6 && (
                      <Badge variant="outline" className="text-xs">+{parsedFile.headers.length - 6} more</Badge>
                    )}
                  </div>
                  <Button onClick={handleAnalyze} disabled={parsing}>
                    Analyze <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: ANALYZE ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">Analyzing Your Data</h2>
                <p className="text-sm text-muted-foreground">Detecting column structure and mapping to CRM fields using semantic analysis.</p>
              </div>

              {analyzeImport.isPending ? (
                <div className="space-y-4 py-8">
                  {["Detecting column structure…", "Matching names to CRM fields…", "Identifying combined values…", "Scoring confidence levels…", "Checking for duplicate file…"].map((msg, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      <span className="text-sm text-muted-foreground">{msg}</span>
                    </div>
                  ))}
                </div>
              ) : mappings.length > 0 ? (
                <div className="space-y-4">
                  {/* Duplicate file warning */}
                  {duplicateFileWarning && (
                    <Alert className="border-amber-300 bg-amber-50">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-800">
                        <strong>Duplicate File Detected.</strong> {duplicateFileWarning}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Low confidence gate */}
                  {lowConfidenceColumns.length > 0 && (
                    <Alert className="border-orange-300 bg-orange-50">
                      <Info className="h-4 w-4 text-orange-600" />
                      <AlertDescription className="text-orange-800 text-sm">
                        <strong>{lowConfidenceColumns.length} column(s)</strong> have low mapping confidence (&lt;60%) and require manual review:{" "}
                        {lowConfidenceColumns.slice(0, 4).map(c => (
                          <code key={c} className="bg-orange-100 px-1 rounded mx-0.5 text-xs">{c}</code>
                        ))}
                        {lowConfidenceColumns.length > 4 && `…+${lowConfidenceColumns.length - 4} more`}. You will be taken to the mapping step.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: "Columns Detected", value: mappings.length, color: "text-foreground" },
                      { label: "Auto-Mapped", value: mappings.filter(m => m.suggestedField).length, color: "text-green-600" },
                      { label: "Need Review", value: mappings.filter(m => !m.suggestedField || m.confidence < 60).length, color: lowConfidenceColumns.length > 0 ? "text-orange-600" : "text-yellow-600" },
                      { label: "Warnings", value: warnings.length, color: "text-orange-600" },
                    ].map(stat => (
                      <Card key={stat.label} className="p-4">
                        <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                      </Card>
                    ))}
                  </div>

                  {warnings.length > 0 && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <ul className="list-disc list-inside space-y-1">
                          {warnings.map((w, i) => <li key={i} className="text-sm">{w}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {entityHints.length > 0 && (
                    <div className="rounded-md bg-blue-50 border border-blue-200 p-3 space-y-1">
                      <p className="text-xs font-semibold text-blue-700">Entity Extraction</p>
                      {entityHints.map((h, i) => <p key={i} className="text-xs text-blue-600">{h}</p>)}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button onClick={() => setStep(3)}>
                      {lowConfidenceColumns.length > 0 ? "Review Mappings (Required)" : "Review Mappings"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    {lowConfidenceColumns.length === 0 && unknownColumns.length === 0 && warnings.length === 0 && (
                      <Button variant="outline" onClick={() => setStep(4)}>
                        Skip to Preview <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* ── STEP 3: FIELD MAPPING ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold mb-1">Field Mapping</h2>
                  <p className="text-sm text-muted-foreground">Review and adjust mappings. ★ = required. Columns highlighted in orange need attention.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setShowLoadTemplate(true)}>
                    <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                    Load Template
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowSaveTemplate(true)}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Save Template
                  </Button>
                </div>
              </div>

              {lowConfidenceColumns.length > 0 && (
                <Alert className="border-orange-300 bg-orange-50">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <AlertDescription className="text-sm text-orange-800">
                    <strong>Manual review required</strong> — {lowConfidenceColumns.length} column(s) were mapped with &lt;60% confidence (highlighted in orange below). Please confirm or correct them before proceeding.
                  </AlertDescription>
                </Alert>
              )}

              <ScrollArea className="h-[420px] rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted border-b">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground w-1/4">Source Column</th>
                      <th className="text-left p-3 font-medium text-muted-foreground w-1/4">Sample Values</th>
                      <th className="text-left p-3 font-medium text-muted-foreground w-1/4">CRM Field</th>
                      <th className="text-left p-3 font-medium text-muted-foreground w-1/4">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m, i) => {
                      const isLowConf = m.suggestedField && m.confidence < 60;
                      const isUnmapped = !m.suggestedField;
                      return (
                        <tr key={m.sourceColumn} className={`border-b transition-colors ${isLowConf ? "bg-orange-50/60" : isUnmapped ? "bg-yellow-50/40" : ""}`}>
                          <td className="p-3">
                            <div className="font-medium">{m.sourceColumn}</div>
                            {m.isCombined && <Badge variant="outline" className="text-xs mt-1 border-blue-300 text-blue-600">combined</Badge>}
                            {isLowConf && <Badge variant="outline" className="text-xs mt-1 border-orange-300 text-orange-600 ml-1">review</Badge>}
                          </td>
                          <td className="p-3">
                            <div className="text-xs text-muted-foreground space-y-0.5">
                              {m.sampleValues.slice(0, 3).map((v, j) => (
                                <div key={j} className="truncate max-w-[180px]" title={v}>{v || <span className="italic">empty</span>}</div>
                              ))}
                            </div>
                          </td>
                          <td className="p-3">
                            <Select
                              value={m.suggestedField ?? "__skip__"}
                              onValueChange={val => setMappings(prev => prev.map((mm, idx) =>
                                idx === i ? { ...mm, suggestedField: val === "__skip__" ? null : val } : mm
                              ))}
                            >
                              <SelectTrigger className={`w-full text-xs h-8 ${isLowConf ? "border-orange-400" : ""}`}>
                                <SelectValue placeholder="— Skip —" />
                              </SelectTrigger>
                              <SelectContent>
                                {CRM_FIELD_OPTIONS.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-3">
                            {m.suggestedField ? (
                              <div className="space-y-1">
                                <Badge className={`text-xs border font-mono ${confidenceColor(m.confidence)}`}>{m.confidence}%</Badge>
                                <div className="text-xs text-muted-foreground">{detectionLabel(m.detectionMethod)}</div>
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">Skipped</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollArea>

              {unknownColumns.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>{unknownColumns.length} column(s)</strong> could not be auto-mapped:{" "}
                    {unknownColumns.slice(0, 5).map(c => <code key={c} className="bg-muted px-1 rounded text-xs mx-0.5">{c}</code>)}
                    {unknownColumns.length > 5 && "…"} — map them above or they will be skipped.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
                <Button onClick={() => setStep(4)}>Preview Data <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </div>
          )}

          {/* ── STEP 4: PREVIEW ── */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold mb-1">Data Preview</h2>
                  <p className="text-sm text-muted-foreground">
                    Showing first {Math.min(50, previewRows.length)} of {parsedFile?.rows.length.toLocaleString()} rows with your confirmed mappings applied.
                  </p>
                </div>
                <Badge variant="secondary">{parsedFile?.rows.length.toLocaleString()} total rows</Badge>
              </div>

              <ScrollArea className="h-[380px] rounded-md border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="sticky top-0 bg-muted border-b">
                      <tr>
                        <th className="text-left p-2.5 font-medium text-muted-foreground w-10">#</th>
                        {["companyName", "contactPerson", "email", "phone", "location", "industry", "priority"].map(f => (
                          <th key={f} className="text-left p-2.5 font-medium text-muted-foreground">{CRM_FIELD_LABELS[f] ?? f}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, idx) => {
                        const missingRequired = requiredFields.some(f => !row[f]);
                        return (
                          <tr key={idx} className={`border-b ${missingRequired ? "bg-red-50/60" : "hover:bg-muted/30"}`}>
                            <td className="p-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                            {["companyName", "contactPerson", "email", "phone", "location", "industry", "priority"].map(f => (
                              <td key={f} className="p-2.5 max-w-[160px] truncate" title={row[f]}>
                                {row[f] ? (
                                  <span className={f === "priority" ? `font-medium ${row[f] === "hot" ? "text-red-600" : row[f] === "warm" ? "text-yellow-600" : "text-blue-600"}` : ""}>{row[f]}</span>
                                ) : (
                                  requiredFields.includes(f)
                                    ? <span className="text-red-500 text-xs italic">missing</span>
                                    : <span className="text-muted-foreground/40 text-xs">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ScrollArea>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(3)}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
                <Button onClick={handleValidate} disabled={validateImport.isPending}>
                  {validateImport.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Check for Duplicates <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 5: VALIDATE ── */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-1">Validation Results</h2>
                <p className="text-sm text-muted-foreground">Review duplicates and errors before import.</p>
              </div>

              {validateImport.isPending ? (
                <div className="flex items-center gap-3 py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-muted-foreground">Checking for duplicates…</span>
                </div>
              ) : validation ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: "New Leads", value: validation.uniqueRows, icon: CheckCircle2, color: "text-green-600" },
                      { label: "Duplicates", value: validation.duplicateRows, icon: RefreshCw, color: "text-yellow-600" },
                      { label: "Invalid Rows", value: validation.invalidRows, icon: XCircle, color: "text-red-600" },
                      { label: "Total Rows", value: validation.totalRows, icon: Users, color: "text-foreground" },
                    ].map(s => (
                      <Card key={s.label} className="p-4">
                        <s.icon className={`h-4 w-4 ${s.color} mb-1`} />
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                      </Card>
                    ))}
                  </div>

                  {validation.duplicateRows > 0 && (
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">Duplicate Resolution</Label>
                      <RadioGroup value={duplicateAction} onValueChange={v => setDuplicateAction(v as DuplicateAction)} className="space-y-2">
                        {[
                          { value: "skip", label: "Skip duplicates", desc: `${validation.duplicateRows} row(s) with matching emails will be skipped` },
                          { value: "update", label: "Update existing records", desc: "Overwrite matching leads with new column values" },
                          { value: "import_anyway", label: "Import as new leads", desc: "Create new leads even if email already exists" },
                        ].map(opt => (
                          <div key={opt.value}
                            className={`flex items-start space-x-3 rounded-md border p-3 cursor-pointer transition-colors ${duplicateAction === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
                            onClick={() => setDuplicateAction(opt.value as DuplicateAction)}>
                            <RadioGroupItem value={opt.value} id={opt.value} className="mt-0.5" />
                            <div>
                              <Label htmlFor={opt.value} className="font-medium cursor-pointer">{opt.label}</Label>
                              <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                            </div>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>
                  )}

                  {validation.validationErrors.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-red-600">Rows with Errors ({validation.validationErrors.length})</Label>
                      <ScrollArea className="h-40 rounded border bg-red-50/30">
                        <div className="p-3 space-y-1">
                          {validation.validationErrors.slice(0, 20).map((e, i) => (
                            <div key={i} className="text-xs flex gap-2">
                              <span className="text-muted-foreground shrink-0">Row {e.rowNum}</span>
                              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                              <span className="text-red-700">{e.message}</span>
                            </div>
                          ))}
                          {validation.validationErrors.length > 20 && (
                            <p className="text-xs text-muted-foreground italic">…and {validation.validationErrors.length - 20} more</p>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setStep(4)}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
                    <Button onClick={handleStartImport} disabled={validation.uniqueRows === 0 && duplicateAction === "skip"}>
                      Start Import <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* ── STEP 6: IMPORTING ── */}
          {step === 6 && (
            <div className="space-y-6 py-4">
              <div>
                <h2 className="text-xl font-semibold mb-1">Importing Data</h2>
                <p className="text-sm text-muted-foreground">Processing {parsedFile?.rows.length.toLocaleString()} rows. All activity is being logged to the audit trail.</p>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{progress.done.toLocaleString()} / {progress.total.toLocaleString()} rows</span>
                </div>
                <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} className="h-3" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Imported", value: progress.imported, color: "text-green-600" },
                  { label: "Skipped", value: progress.skipped, color: "text-yellow-600" },
                  { label: "Updated", value: progress.updated, color: "text-blue-600" },
                  { label: "Failed", value: progress.failed, color: "text-red-600" },
                ].map(s => (
                  <Card key={s.label} className="p-4">
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </Card>
                ))}
              </div>
              {importing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing in batches of 100 rows. Import can be rolled back after completion.
                </div>
              )}
            </div>
          )}

          {/* ── STEP 7: REPORT ── */}
          {step === 7 && importResult && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
                <div>
                  <h2 className="text-xl font-semibold">Import Complete!</h2>
                  <p className="text-sm text-muted-foreground">
                    Completed in {(importResult.durationMs / 1000).toFixed(1)}s · Job #{importResult.id} · Logged to audit trail
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Imported", value: importResult.importedRows, icon: CheckCircle2, color: "text-green-600" },
                  { label: "Skipped", value: importResult.skippedRows, icon: RefreshCw, color: "text-yellow-600" },
                  { label: "Updated", value: importResult.updatedRows, icon: RefreshCw, color: "text-blue-600" },
                  { label: "Failed", value: importResult.failedRows, icon: XCircle, color: "text-red-600" },
                ].map(s => (
                  <Card key={s.label} className="p-4">
                    <s.icon className={`h-4 w-4 ${s.color} mb-1`} />
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </Card>
                ))}
              </div>

              {importResult.errors.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50/30 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-red-700">{importResult.errors.length} row(s) failed</p>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50"
                      onClick={() => window.open(`/api/imports/${importResult.id}/error-report`, "_blank")}>
                      <Download className="mr-2 h-3 w-3" />
                      Download Error Report
                    </Button>
                  </div>
                  <ScrollArea className="h-32">
                    <div className="space-y-1">
                      {importResult.errors.slice(0, 10).map((e, i) => (
                        <p key={i} className="text-xs text-red-600">Row {e.rowNum}: {e.message}</p>
                      ))}
                      {importResult.errors.length > 10 && (
                        <p className="text-xs text-muted-foreground italic">…and {importResult.errors.length - 10} more in error report</p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <Alert className="border-blue-200 bg-blue-50/50">
                <RotateCcw className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800 text-sm">
                  This import can be <strong>rolled back</strong> at any time from the Import History below — all {importResult.importedRows} leads will be deleted.
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={handleReset}>
                  <Upload className="mr-2 h-4 w-4" />Import Another File
                </Button>
                <Link href="/leads">
                  <Button><Users className="mr-2 h-4 w-4" />View Leads</Button>
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Import History ── */}
      {historyData?.jobs && historyData.jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Import History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {(historyData.jobs as ImportJobSummary[]).map((job) => (
                <div key={job.id} className="flex items-center justify-between px-6 py-3 gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{job.fileName ?? "import"}</p>
                      <p className="text-xs text-muted-foreground">
                        {job.totalRows.toLocaleString()} rows · {format(parseISO(job.createdAt), "MMM d, yyyy h:mm a")}
                        {job.rollbackedAt && <span className="ml-2 text-muted-foreground">Rolled back {format(parseISO(job.rollbackedAt), "MMM d")}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right text-xs text-muted-foreground hidden sm:block">
                      <span className="text-green-600 font-medium">{job.importedRows} imported</span>
                      {job.skippedRows > 0 && <span className="ml-2 text-yellow-600">{job.skippedRows} skipped</span>}
                      {job.failedRows > 0 && <span className="ml-2 text-red-600">{job.failedRows} failed</span>}
                    </div>
                    <Badge
                      variant={job.status === "complete" ? "secondary" : job.status === "rolled_back" ? "outline" : job.status === "failed" ? "destructive" : "outline"}
                      className={`text-xs ${job.status === "rolled_back" ? "text-muted-foreground" : ""}`}
                    >
                      {job.status === "rolled_back" ? "rolled back" : job.status}
                    </Badge>
                    {job.failedRows > 0 && job.status === "complete" && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => downloadErrorReport(job)}>
                        <Download className="mr-1 h-3 w-3" />
                        Errors
                      </Button>
                    )}
                    {job.canRollback && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setRollbackJob(job)}>
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Rollback
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
