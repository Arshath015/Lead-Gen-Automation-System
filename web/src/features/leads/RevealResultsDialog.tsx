import { CheckCircle2, XCircle, Info, MinusCircle } from "lucide-react";
import { Modal } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import type { RevealResult } from "../../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: RevealResult[];
}

const OUTCOME_META = {
  revealed: { icon: CheckCircle2, className: "text-emerald-600", label: "Revealed" },
  already_revealed: { icon: Info, className: "text-accent-600", label: "Already revealed" },
  failed: { icon: XCircle, className: "text-red-600", label: "Failed" },
  skipped: { icon: MinusCircle, className: "text-gray-400", label: "Skipped" },
} as const;

export function RevealResultsDialog({ open, onOpenChange, results }: Props) {
  const revealed = results.filter((r) => r.outcome === "revealed").length;
  const alreadyRevealed = results.filter((r) => r.outcome === "already_revealed").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Reveal results"
      description={
        [
          revealed > 0 ? `${revealed} revealed` : null,
          alreadyRevealed > 0 ? `${alreadyRevealed} already had an email` : null,
          failed > 0 ? `${failed} failed` : null,
          skipped > 0 ? `${skipped} skipped` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      className="max-w-lg"
    >
      <div className="max-h-96 space-y-1.5 overflow-y-auto">
        {results.map((r) => {
          const meta = OUTCOME_META[r.outcome];
          const Icon = meta.icon;
          return (
            <div key={r.id} className="flex items-start gap-2.5 rounded-lg border border-border-subtle px-3 py-2.5">
              <Icon className={"mt-0.5 size-4 shrink-0 " + meta.className} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-medium text-ink">{r.fullName}</p>
                  <span className={"shrink-0 text-[11px] font-medium " + meta.className}>{meta.label}</span>
                </div>
                {r.outcome === "revealed" || r.outcome === "already_revealed" ? (
                  <p className="truncate text-xs text-gray-500">{r.email}</p>
                ) : r.error ? (
                  <p className="text-xs text-gray-500">{r.error}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end pt-3">
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
