import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onOpenChange, title, description, children, className }: ModalProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30 animate-overlay-in" />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[min(85vh,720px)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col",
            "animate-modal-in rounded-2xl border border-border bg-surface shadow-popover focus:outline-none",
            className
          )}
        >
          <div className="flex shrink-0 items-start justify-between border-b border-border-subtle px-6 py-5">
            <div>
              <RadixDialog.Title className="text-[15px] font-bold text-ink">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-0.5 text-xs text-gray-500">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          {/* Only this middle section scrolls — header and (any) footer the
              caller renders inside children stay pinned, so a form with more
              fields than fit the viewport never traps its submit button
              off-screen. */}
          <div className="scroll-contain px-6 py-5">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function Sheet({ open, onOpenChange, children, className }: SheetProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/20 animate-overlay-in" />
        <RadixDialog.Content
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col",
            "animate-sheet-in border-l border-border bg-surface shadow-sheet focus:outline-none",
            className
          )}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
export const DialogTitle = RadixDialog.Title;
