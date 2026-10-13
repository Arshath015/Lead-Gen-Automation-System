import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive" | "outline";
type Size = "sm" | "md" | "icon";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-600 text-white shadow-sm hover:bg-accent-700 disabled:bg-accent-200",
  secondary: "bg-ink text-white hover:bg-[#2a2a2f] disabled:bg-gray-300",
  outline: "border border-border bg-surface text-ink hover:bg-gray-50 disabled:opacity-50",
  ghost: "text-gray-600 hover:bg-gray-100 hover:text-ink disabled:opacity-50",
  destructive: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-200",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-[38px] px-4 text-[13px] gap-2 rounded-xl",
  icon: "size-8 rounded-lg justify-center",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "outline", size = "md", loading, disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center font-medium transition-colors duration-100 whitespace-nowrap select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
});
