import { cn } from "../../lib/cn";

export function StatTile({
  value,
  label,
  tone = "default",
}: {
  value: string | number;
  label: string;
  tone?: "default" | "accent" | "warn";
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3 text-center">
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "accent" && "text-accent-600",
          tone === "warn" && "text-amber-600",
          tone === "default" && "text-ink"
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">{label}</p>
    </div>
  );
}
