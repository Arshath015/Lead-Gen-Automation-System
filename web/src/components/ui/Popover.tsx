import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({
  children,
  className,
  align = "start",
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "end" | "center";
}) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        avoidCollisions
        className={cn(
          "z-50 w-max rounded-2xl border border-border bg-surface p-4 shadow-popover",
          "data-[state=open]:animate-modal-in",
          // Radix reports how much room is actually left on whichever side it
          // picked (flipping above/below/etc. near viewport edges on its
          // own); capping height to that and scrolling internally is what
          // keeps long panels reachable instead of running off-screen.
          "scroll-contain max-h-[var(--radix-popover-content-available-height)]",
          className
        )}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
