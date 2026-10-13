type PipelineStage = { stageId: number; stageName: string; count: number };

/** Recharts Bar events provide the row under payload, not on the event itself. */
export function stageIdFromBarEvent(event: unknown): number | null {
  if (typeof event !== "object" || event === null) return null;
  const bar = event as { payload?: { stageId?: unknown }; stageId?: unknown };
  const id = bar.payload?.stageId ?? bar.stageId;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function PipelineStageLinks({
  stages, onSelect,
}: {
  stages: PipelineStage[];
  onSelect: (stageId: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Filter leads by pipeline stage">
      {stages.map(stage => (
        <button
          key={stage.stageId}
          type="button"
          onClick={() => onSelect(stage.stageId)}
          className="rounded-lg border px-2 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          title={`View ${stage.count} leads in ${stage.stageName}`}
        >
          {stage.stageName} <span className="opacity-60">({stage.count})</span>
        </button>
      ))}
    </div>
  );
}