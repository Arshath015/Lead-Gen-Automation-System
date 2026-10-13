import { useCallback } from "react";
import React from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

/**
 * General-purpose 5-second undo window for any deferred action.
 *
 * Usage:
 *   const { execute } = useUndoAction();
 *   execute(
 *     "Contact deleted.",
 *     async () => { ... },      // called after 5 s if not undone
 *     () => { ... },             // called immediately – optimistic update (optional)
 *     () => { ... },             // called on undo click – revert optimistic (optional)
 *   );
 */
export function useUndoAction() {
  const { toast } = useToast();

  const execute = useCallback(
    (
      label: string,
      onCommit: () => Promise<void>,
      onOptimistic?: () => void,
      onUndo?: () => void,
    ) => {
      onOptimistic?.();

      let undone = false;
      let committed = false;
      let toastDismiss: (() => void) | null = null;

      const timer = setTimeout(async () => {
        if (undone) return;
        committed = true;
        toastDismiss?.();
        await onCommit();
      }, 5000);

      const t = toast({
        description: label,
        duration: 5100,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        action: React.createElement(ToastAction, {
          altText: "Undo",
          onClick: () => {
            if (committed) return; // already fired — too late
            undone = true;
            clearTimeout(timer);
            onUndo?.();
            toastDismiss?.();
          },
        }, "Undo") as any,
      });
      toastDismiss = t.dismiss;
    },
    [toast],
  );

  return { execute };
}
