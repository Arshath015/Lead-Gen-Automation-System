import { cn } from "../../lib/cn";

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-border-subtle bg-gray-50 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
            value === opt.value ? "bg-accent-50 text-accent-700 shadow-sm" : "text-gray-500 hover:text-ink"
          )}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10.5px] tabular-nums",
                value === opt.value ? "bg-accent-100 text-accent-700" : "bg-gray-200 text-gray-500"
              )}
            >
              {opt.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
