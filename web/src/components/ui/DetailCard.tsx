import type { ReactNode } from "react";

export function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card">
      <h3 className="text-[15px] font-bold text-ink">{title}</h3>
      <div className="mt-3 divide-y divide-border-subtle">{children}</div>
    </div>
  );
}

export function DetailRow({
  icon,
  iconClassName = "bg-gray-100 text-gray-500",
  label,
  value,
}: {
  icon: ReactNode;
  iconClassName?: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${iconClassName}`}>{icon}</span>
        <span className="text-[13.5px] text-gray-600">{label}</span>
      </div>
      <span className="text-[14px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}
