import { AlertTriangle } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useImportWizard, type WizardStep } from "./useImportWizard";
import { UploadStep } from "./UploadStep";
import { ColumnMappingStep } from "./ColumnMappingStep";
import { ImportSummaryStep } from "./ImportSummaryStep";
import { ImportResultStep } from "./ImportResultStep";

const STEP_ORDER: WizardStep[] = ["upload", "mapping", "summary", "result"];
const STEP_LABELS: Record<WizardStep, string> = {
  upload: "Upload",
  mapping: "Map columns",
  summary: "Review",
  result: "Done",
};

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIndex = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex items-center gap-2 px-6 pb-4 text-[12px] font-medium text-gray-400">
      {STEP_ORDER.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`flex size-5 items-center justify-center rounded-full text-[10.5px] ${
                active ? "bg-accent-600 text-white" : done ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-400"
              }`}
            >
              {i + 1}
            </span>
            <span className={active ? "text-accent-600" : done ? "text-emerald-600" : ""}>{STEP_LABELS[s]}</span>
            {i < STEP_ORDER.length - 1 && <span className="mx-1 h-px w-6 bg-border-subtle" />}
          </li>
        );
      })}
    </ol>
  );
}

export function ImportPage() {
  const wizard = useImportWizard();
  const showCancel = wizard.step === "mapping" || wizard.step === "summary";

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader
        title="Import Leads"
        description="Upload a spreadsheet, map its columns, review a preview, then confirm to commit new leads."
        actions={
          showCancel ? (
            <Button variant="ghost" onClick={wizard.requestCancel}>
              Cancel import
            </Button>
          ) : undefined
        }
      />

      <StepIndicator current={wizard.step} />

      {wizard.commitError && (
        <div className="mx-6 mb-4 flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{wizard.commitError}</span>
        </div>
      )}

      {wizard.step === "upload" && <UploadStep uploading={wizard.uploading} uploadError={wizard.uploadError} onUpload={wizard.upload} />}

      {wizard.step === "mapping" && (
        <ColumnMappingStep
          files={wizard.files}
          onToggleWorksheet={wizard.toggleWorksheet}
          onUpdateMapping={wizard.updateMapping}
          selectedCount={wizard.selections.length}
          previewing={wizard.previewing}
          previewError={wizard.previewError}
          onPreview={wizard.runPreview}
        />
      )}

      {wizard.step === "summary" && wizard.preview && (
        <ImportSummaryStep
          summary={wizard.preview}
          isStale={wizard.isStale}
          previewing={wizard.previewing}
          onRerunPreview={wizard.runPreview}
          onBack={wizard.backToMapping}
          onRequestCommit={wizard.requestCommit}
        />
      )}

      {wizard.step === "result" && wizard.commitResult && wizard.stagingId && (
        <ImportResultStep result={wizard.commitResult} stagingId={wizard.stagingId} onStartNew={wizard.reset} />
      )}

      <ConfirmDialog
        open={wizard.confirmOpen}
        onOpenChange={wizard.setConfirmOpen}
        title="Import these leads?"
        description={
          wizard.preview
            ? `This will create up to ${wizard.preview.totals.willImportRows.toLocaleString()} new leads. Duplicate and invalid rows are skipped automatically. This action cannot be undone.`
            : undefined
        }
        confirmLabel="Import"
        loading={wizard.committing}
        onConfirm={wizard.confirmCommit}
      />

      <ConfirmDialog
        open={wizard.cancelOpen}
        onOpenChange={wizard.setCancelOpen}
        title="Cancel this import?"
        description="Your uploaded file and mapping choices will be discarded. Nothing has been added to your leads yet."
        confirmLabel="Discard"
        destructive
        loading={wizard.cancelling}
        onConfirm={wizard.confirmCancel}
      />
    </div>
  );
}
