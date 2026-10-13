import { Badge } from "@/components/ui/badge";
import { Flame, Thermometer, Snowflake } from "lucide-react";

type Priority = "hot" | "warm" | "cold" | null | undefined;

const config: Record<NonNullable<Priority>, { label: string; className: string; Icon: React.ElementType }> = {
  hot: { label: "Hot", className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900", Icon: Flame },
  warm: { label: "Warm", className: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900", Icon: Thermometer },
  cold: { label: "Cold", className: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900", Icon: Snowflake },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (!priority) return null;
  const { label, className, Icon } = config[priority];
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-medium ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export function PrioritySelect({
  value,
  onChange,
  className,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  className?: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value || null)}
      className={`flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring ${className ?? ""}`}
    >
      <option value="">No Priority</option>
      <option value="hot">🔥 Hot</option>
      <option value="warm">🌡️ Warm</option>
      <option value="cold">❄️ Cold</option>
    </select>
  );
}
