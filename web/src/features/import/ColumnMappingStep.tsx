import { AlertTriangle, Check, ChevronDown, FileSpreadsheet } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Switch } from "../../components/ui/Switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/DropdownMenu";
import { selectClass } from "../../components/ui/field";
import { cn } from "../../lib/cn";
import type { CanonicalField } from "../../types";
import { CANONICAL_FIELD_META, isLikelyNonContactSheet } from "./canonicalFields";
import type { FileState, WorksheetState } from "./useImportWizard";

// A fully custom, fully-controlled replacement for a native <select> for
// choosing a source column: the currently-mapped header is read directly out
// of React state and rendered as plain, individually-spaced menu rows (via
// DropdownMenuItem), rather than relying on the browser's own OS-rendered
// option list — which not only looked cramped/hard to scan for long header
// names, but also could visually desync from the real selection (whatever
// the browser's native <select> happens to highlight isn't necessarily what
// `value` was set to, e.g. when the matching <option> was conditionally
// omitted from the DOM). This never has that failure mode: the trigger's
// label IS the state, not a separate thing the browser is trusted to keep in
// sync with it.
function ColumnSelect({
  headers,
  duplicateHeaderTexts,
  value,
  onChange,
}: {
  headers: string[];
  duplicateHeaderTexts: Set<string>;
  value: number | null;
  onChange: (index: number | null) => void;
}) {
  function optionLabel(index: number): string {
    const header = headers[index];
    return duplicateHeaderTexts.has(header) ? `${header} (col ${index + 1})` : header;
  }
  const selectedLabel = value !== null && headers[value] ? optionLabel(value) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(selectClass, "mt-1 flex w-full items-center justify-between gap-2 text-left", !selectedLabel && "text-gray-400")}
        >
          <span className="truncate">{selectedLabel ?? "— Leave blank —"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-[260px] overflow-y-auto">
        <DropdownMenuItem onSelect={() => onChange(null)} icon={value === null ? <Check className="size-3.5" /> : <span className="size-3.5" />}>
          — Leave blank —
        </DropdownMenuItem>
        {headers.map((header, index) =>
          header ? (
            <DropdownMenuItem
              key={index}
              onSelect={() => onChange(index)}
              icon={value === index ? <Check className="size-3.5" /> : <span className="size-3.5" />}
            >
              <span className="truncate">{optionLabel(index)}</span>
            </DropdownMenuItem>
          ) : null
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Props {
  files: FileState[];
  onToggleWorksheet: (fileId: string, sheetName: string, selected: boolean) => void;
  onUpdateMapping: (fileId: string, sheetName: string, field: CanonicalField, columnIndex: number | null) => void;
  selectedCount: number;
  previewing: boolean;
  previewError: string | null;
  onPreview: () => void;
}

function WorksheetCard({
  fileId,
  originalFilename,
  worksheet,
  onToggleWorksheet,
  onUpdateMapping,
}: {
  fileId: string;
  originalFilename: string;
  worksheet: WorksheetState;
  onToggleWorksheet: Props["onToggleWorksheet"];
  onUpdateMapping: Props["onUpdateMapping"];
}) {
  if (!worksheet.importable) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-gray-50 p-5 opacity-75">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-gray-400" />
          <span className="text-[13.5px] font-semibold text-gray-500">{worksheet.name}</span>
          <Badge tone="gray">Not importable</Badge>
        </div>
        <p className="mt-2 text-[12.5px] text-gray-400">
          No header row could be detected in this sheet (e.g. a summary/narrative tab) — it will be skipped.
        </p>
      </div>
    );
  }

  // Zero canonical fields auto-detected at all (e.g. a "Master Summary"
  // metadata tab with a couple of key/value rows, not a contact table) —
  // shown as clearly excluded by default rather than a normal mapping card
  // demanding the user resolve ten "Unmapped" badges for a sheet that was
  // never going to have contacts in it. The switch still lets the user
  // override and map it by hand if this guess is wrong for their file.
  const looksLikeSummarySheet = isLikelyNonContactSheet(worksheet.missingFields);
  if (looksLikeSummarySheet && !worksheet.selected) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-gray-50 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-gray-400" />
            <div>
              <p className="text-[13.5px] font-semibold text-gray-500">{worksheet.name}</p>
              <p className="text-[11.5px] text-gray-400">{originalFilename}</p>
            </div>
            <Badge tone="gray">Excluded — summary sheet</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-gray-400">Excluded</span>
            <Switch
              checked={worksheet.selected}
              onChange={(v) => onToggleWorksheet(fileId, worksheet.name, v)}
              ariaLabel={`Include worksheet ${worksheet.name}`}
            />
          </div>
        </div>
        <p className="mt-2 text-[12.5px] text-gray-400">
          No recognizable contact columns were detected in this sheet — it looks like a summary or metadata tab rather
          than a contact list, so it's excluded by default and won't count toward import totals. Turn it on above if you
          want to map it manually instead.
        </p>
      </div>
    );
  }

  const duplicateHeaderTexts = new Set(worksheet.duplicateHeaders.map((d) => d.header));

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-accent-600" />
          <div>
            <p className="text-[13.5px] font-semibold text-ink">{worksheet.name}</p>
            <p className="text-[11.5px] text-gray-400">
              {originalFilename} · ~{worksheet.approxDataRowCount.toLocaleString()} data rows
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-gray-400">{worksheet.selected ? "Included" : "Excluded"}</span>
          <Switch
            checked={worksheet.selected}
            onChange={(v) => onToggleWorksheet(fileId, worksheet.name, v)}
            ariaLabel={`Include worksheet ${worksheet.name}`}
          />
        </div>
      </div>

      {worksheet.selected && (
        <>
          {(worksheet.missingFields.length > 0 || worksheet.duplicateHeaders.length > 0) && (
            <div className="mt-3 space-y-1.5">
              {worksheet.missingFields.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    No column auto-detected for:{" "}
                    {worksheet.missingFields
                      .map((k) => CANONICAL_FIELD_META.find((m) => m.key === k)?.label ?? k)
                      .join(", ")}
                    . Map manually below or leave blank.
                  </span>
                </div>
              )}
              {worksheet.duplicateHeaders.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Duplicate header{worksheet.duplicateHeaders.length > 1 ? "s" : ""}:{" "}
                    {worksheet.duplicateHeaders.map((d) => `"${d.header}"`).join(", ")} — the auto-suggestion only used the
                    first occurrence; confirm the mapping is correct.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CANONICAL_FIELD_META.map((meta) => {
              // Driven by the LIVE fieldColumns state, not the frozen
              // upload-time missingFields list — an exact-header auto-match
              // (or a manual fix) must clear this badge immediately, not
              // leave it permanently stuck on "Unmapped" for a field that is
              // in fact mapped. This is the actual state the mapping
              // controls act on, so it's the only thing the badge should
              // ever disagree with.
              const isUnmapped = worksheet.fieldColumns[meta.key] == null;
              return (
                <div key={meta.key}>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    {meta.label}
                    {meta.tier === "core" && <Badge tone="violet">Core</Badge>}
                    {isUnmapped && <Badge tone="amber">Unmapped</Badge>}
                  </label>
                  <ColumnSelect
                    headers={worksheet.headers}
                    duplicateHeaderTexts={duplicateHeaderTexts}
                    value={worksheet.fieldColumns[meta.key]}
                    onChange={(index) => onUpdateMapping(fileId, worksheet.name, meta.key, index)}
                  />
                </div>
              );
            })}
          </div>

          {worksheet.unmappedColumns.length > 0 && (
            <p className="mt-3 text-[11.5px] text-gray-400">
              Not mapped to any field: {worksheet.unmappedColumns.map((c) => c.header).join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function ColumnMappingStep({
  files,
  onToggleWorksheet,
  onUpdateMapping,
  selectedCount,
  previewing,
  previewError,
  onPreview,
}: Props) {
  const hasAnyWorksheet = files.some((f) => f.worksheets.length > 0);

  return (
    <div className="px-6 pb-8">
      {!hasAnyWorksheet ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <p className="text-[14px] font-medium text-ink">No worksheets found</p>
          <p className="mt-1 max-w-sm text-[13px] text-gray-500">The uploaded file didn't contain any readable sheets.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {files.map((file) =>
            file.worksheets.map((ws) => (
              <WorksheetCard
                key={`${file.fileId}:${ws.name}`}
                fileId={file.fileId}
                originalFilename={file.originalFilename}
                worksheet={ws}
                onToggleWorksheet={onToggleWorksheet}
                onUpdateMapping={onUpdateMapping}
              />
            ))
          )}
        </div>
      )}

      {previewError && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{previewError}</span>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end border-t border-border-subtle pt-5">
        <Button variant="primary" onClick={onPreview} loading={previewing} disabled={selectedCount === 0}>
          Preview import
        </Button>
      </div>
    </div>
  );
}
