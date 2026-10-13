import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

export function KpiCard({
  label,
  value,
  caption,
  icon,
  chipClassName = "bg-accent-50 text-accent-600",
}: {
  label: string;
  value: string | number;
  caption: string;
  icon: ReactNode;
  chipClassName?: string;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
      <div className="flex items-center gap-3">
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${chipClassName}`}>{icon}</div>
        <span className="text-[13px] font-medium text-gray-500">{label}</span>
      </div>
      <p className="mt-4 text-[30px] font-bold leading-none tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-2 flex items-center gap-1 text-[12px] font-medium text-emerald-600">
        <ArrowUpRight className="size-3.5" />
        {caption}
      </p>
    </div>
  );
}
