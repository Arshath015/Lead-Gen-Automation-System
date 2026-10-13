import { CheckCircle2, XCircle, KeyRound, Sparkles, PenLine, Send, Download, X, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export type BulkAction = "qualify" | "reject" | "reveal" | "research" | "draft" | "send" | "export";

interface Props {
  count: number;
  busyAction: BulkAction | null;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
}

const ACTIONS: { key: BulkAction; label: string; icon: typeof Send; title?: string }[] = [
  { key: "qualify", label: "Qualify", icon: CheckCircle2 },
  { key: "reject", label: "Reject", icon: XCircle },
  {
    key: "reveal",
    label: "Reveal email",
    icon: KeyRound,
    title: "Spends 1 Apollo lead credit per contact — separate from search, which is unmetered",
  },
  { key: "research", label: "Research", icon: Sparkles },
  { key: "draft", label: "Draft", icon: PenLine },
  { key: "send", label: "Send", icon: Send },
  { key: "export", label: "Export", icon: Download },
];

export function BulkActionBar({ count, busyAction, onAction, onClear }: Props) {
  if (count === 0) return null;
  const disabled = busyAction !== null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
      <div className="animate-bar-in pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-border-subtle bg-surface p-2 shadow-popover">
        <span className="flex items-center gap-1.5 rounded-xl bg-accent-50 px-3 py-2 text-[13px] font-semibold text-accent-700">
          {count} selected
          <button onClick={onClear} disabled={disabled} className="rounded-full p-0.5 hover:bg-accent-100 disabled:opacity-40">
            <X className="size-3.5" />
          </button>
        </span>
        {ACTIONS.map(({ key, label, icon: Icon, title }) => (
          <button
            key={key}
            onClick={() => onAction(key)}
            disabled={disabled}
            title={title}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[12.5px] font-medium text-gray-600 whitespace-nowrap transition-colors",
              "hover:bg-gray-50 hover:text-ink disabled:opacity-40",
              busyAction === key && "bg-gray-50"
            )}
          >
            {busyAction === key ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
