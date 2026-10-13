import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { StatTile } from "../../components/ui/StatTile";
import { DetailCard } from "../../components/ui/DetailCard";
import { Badge } from "../../components/ui/Badge";
import { canonicalFieldLabel } from "./canonicalFields";
import type { CanonicalField, ImportPreviewSummary } from "../../types";

interface Props {
  summary: ImportPreviewSummary;
  isStale: boolean;
  previewing: boolean;
  onRerunPreview: () => void;
  onBack: () => void;
  onRequestCommit: () => void;
}

export function ImportSummaryStep({ summary, isStale, previewing, onRerunPreview, onBack, onRequestCommit }: Props) {
  const { totals } = summary;
  const skippedDuplicates = totals.duplicateExistingRows + totals.duplicateInFileRows;

  const blankTotals: Partial<Record<string, number>> = {};
  for (const sheet of summary.sheets) {
    for (const [key, count] of Object.entries(sheet.blankFieldCounts)) {
      blankTotals[key] = (blankTotals[key] ?? 0) + (count ?? 0);
    }
  }
  const blankEntries = Object.entries(blankTotals).filter(([, count]) => (count ?? 0) > 0);

  return (
    <div className="px-6 pb-8">
      {isStale && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0" />
            Column mapping changed since this preview was computed — re-run preview before importing.
          </span>
          <Button size="sm" variant="outline" onClick={onRerunPreview} loading={previewing}>
            <RefreshCcw className="size-3.5" />
            Re-run preview
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile value={totals.totalRows.toLocaleString()} label="Total rows" />
        <StatTile value={totals.willImportRows.toLocaleString()} label="Will import" tone="accent" />
        <StatTile value={skippedDuplicates.toLocaleString()} label="Duplicates skipped" tone="warn" />
        <StatTile value={totals.invalidRows.toLocaleString()} label="Invalid rows" tone="warn" />
        <StatTile value={totals.rowsWithInvalidEmailFormat.toLocaleString()} label="Bad email format" tone="warn" />
      </div>

      <div className="mt-5">
        <DetailCard title="Worksheets in this import">
          {summary.sheets.map((sheet) => (
            <div key={`${sheet.fileId}:${sheet.sheetName}`} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-ink">
                  {sheet.sheetName} <span className="font-normal text-gray-400">· {sheet.originalFilename}</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="gray">{sheet.totalRows.toLocaleString()} total</Badge>
                  <Badge tone="green">{sheet.willImportRows.toLocaleString()} to import</Badge>
                  {sheet.duplicateExistingRows + sheet.duplicateInFileRows > 0 && (
                    <Badge tone="amber">{(sheet.duplicateExistingRows + sheet.duplicateInFileRows).toLocaleString()} duplicates</Badge>
                  )}
                  {sheet.invalidRows > 0 && <Badge tone="red">{sheet.invalidRows.toLocaleString()} invalid</Badge>}
                </div>
              </div>
            </div>
          ))}
        </DetailCard>
      </div>

      {blankEntries.length > 0 && (
        <div className="mt-5">
          <DetailCard title="Missing data in rows that will import">
            <div className="flex flex-wrap gap-2 py-1">
              {blankEntries.map(([key, count]) => (
                <Badge key={key} tone="gray">
                  {canonicalFieldLabel(key as CanonicalField)}: {count} blank
                </Badge>
              ))}
            </div>
          </DetailCard>
        </div>
      )}

      {summary.sampleErrors.length > 0 && (
        <div className="mt-5">
          <DetailCard title={`Sample invalid rows (showing ${summary.sampleErrors.length})`}>
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="text-gray-400">
                    <th className="pb-1.5 pr-3 font-medium">Sheet</th>
                    <th className="pb-1.5 pr-3 font-medium">Row</th>
                    <th className="pb-1.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.sampleErrors.map((err, i) => (
                    <tr key={i} className="border-t border-border-subtle">
                      <td className="py-1.5 pr-3 text-gray-600">{err.sheetName}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-gray-600">{err.rowNumber}</td>
                      <td className="py-1.5 text-gray-600">{err.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        </div>
      )}

      {summary.sampleRecords.length > 0 && (
        <div className="mt-5">
          <DetailCard title={`Preview of rows that will import (showing ${summary.sampleRecords.length})`}>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="text-gray-400">
                    <th className="pb-1.5 pr-3 font-medium">Name</th>
                    <th className="pb-1.5 pr-3 font-medium">Company</th>
                    <th className="pb-1.5 pr-3 font-medium">Email</th>
                    <th className="pb-1.5 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.sampleRecords.map((rec, i) => (
                    <tr key={i} className="border-t border-border-subtle">
                      <td className="py-1.5 pr-3 text-ink">{rec.fullName ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{rec.company ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{rec.email ?? "—"}</td>
                      <td className="py-1.5 text-gray-600">{rec.location ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-border-subtle pt-5">
        <Button variant="ghost" onClick={onBack}>
          Back to mapping
        </Button>
        <Button variant="primary" onClick={onRequestCommit} disabled={isStale || totals.willImportRows === 0}>
          Confirm &amp; import {totals.willImportRows.toLocaleString()} leads
        </Button>
      </div>
    </div>
  );
}
