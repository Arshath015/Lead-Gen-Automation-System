const BAR_SHADES = ["bg-accent-900", "bg-accent-700", "bg-accent-600", "bg-accent-500", "bg-blue-400"];

function niceMax(n: number): number {
  if (n <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  const residual = n / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

function formatTick(n: number): string {
  if (n >= 1000) {
    const thousands = n / 1000;
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(2)}K`;
  }
  return String(n);
}

export function PipelineFunnel({ rows }: { rows: { label: string; count: number }[] }) {
  const max = niceMax(Math.max(...rows.map((r) => r.count), 1));
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];

  return (
    <div>
      <div className="space-y-3.5">
        {rows.map((row, i) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-[12.5px] text-gray-500">{row.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${BAR_SHADES[i % BAR_SHADES.length]}`}
                style={{ width: `${Math.max((row.count / max) * 100, row.count > 0 ? 2 : 0)}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-ink">{row.count}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex pl-[7rem]">
        {ticks.map((t) => (
          <span key={t} className="flex-1 text-[10.5px] text-gray-400 first:-ml-2 last:text-right">
            {formatTick(Math.round(t))}
          </span>
        ))}
      </div>
    </div>
  );
}
