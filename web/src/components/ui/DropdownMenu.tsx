import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;

export function DropdownMenuContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        avoidCollisions
        className={cn(
          "z-50 min-w-[190px] rounded-xl border border-border bg-surface p-1.5 shadow-popover",
          "data-[state=open]:animate-modal-in",
          // Same reasoning as PopoverContent: a long menu near the bottom of
          // the viewport scrolls internally instead of being clipped by
          // whatever ancestor happens to have overflow:hidden.
          "scroll-contain max-h-[var(--radix-dropdown-menu-content-available-height)]",
          className
        )}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  destructive,
  disabled,
  icon,
}: {
  children: ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <RadixMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none",
        "data-[highlighted]:bg-gray-100",
        destructive ? "text-red-600" : "text-ink",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      {icon}
      {children}
    </RadixMenu.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">{children}</div>;
}

export function DropdownMenuSeparator() {
  return <RadixMenu.Separator className="my-1 h-px bg-border-subtle" />;
}
