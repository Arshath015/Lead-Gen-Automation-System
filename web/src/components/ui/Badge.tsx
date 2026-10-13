import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "gray" | "blue" | "green" | "red" | "amber" | "violet";

const TONES: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-600",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-700",
  violet: "bg-accent-50 text-accent-700",
};

export function Badge({
  tone = "gray",
  children,
  icon,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium leading-none",
        TONES[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
