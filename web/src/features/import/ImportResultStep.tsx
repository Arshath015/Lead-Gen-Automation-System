import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { StatTile } from "../../components/ui/StatTile";
import { api } from "../../api/client";
import type { ImportCommitResult } from "../../types";

interface Props {
  result: ImportCommitResult;
  stagingId: string;
  onStartNew: () => void;
}

export function ImportResultStep({ result, stagingId, onStartNew }: Props) {
  return (
    <div className="px-6 pb-8">
      <div className="flex flex-col items-center rounded-2xl border border-border-subtle bg-surface p-8 text-center shadow-card">
        {result.aborted ? (
          <AlertTriangle className="size-8 text-amber-500" />
        ) : (
          <CheckCircle2 className="size-8 text-emerald-500" />
        )}
        <p className="mt-3 text-[16px] font-bold text-ink">
          {result.aborted ? "Import stopped early" : "Import complete"}
        </p>
        {result.abortReason && <p className="mt-1 max-w-md text-[13px] text-amber-700">{result.abortReason}</p>}

        <div className="mt-5 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile value={result.imported.toLocaleString()} label="Imported" tone="accent" />
          <StatTile value={result.skippedDuplicates.toLocaleString()} label="Duplicates skipped" />
          <StatTile value={result.invalidRows.toLocaleString()} label="Invalid rows" tone={result.invalidRows > 0 ? "warn" : "default"} />
          <StatTile value={result.failedRows.toLocaleString()} label="Failed to write" tone={result.failedRows > 0 ? "warn" : "default"} />
        </div>

        {result.errorRowCount > 0 && (
          <a
            href={api.importErrorsCsvUrl(stagingId)}
            download
            className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-600 hover:underline"
          >
            <Download className="size-3.5" />
            Download error report ({result.errorRowCount} rows)
          </a>
        )}

        <Button variant="primary" className="mt-6" onClick={onStartNew}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
