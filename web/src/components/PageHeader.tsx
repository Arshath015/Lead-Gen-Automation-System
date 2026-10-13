import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
