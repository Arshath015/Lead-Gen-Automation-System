import { useEffect, useRef, useState } from "react";
import { Paperclip, Plus, Trash2, Loader2, FileText } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Switch";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import type { DefaultAttachment } from "../../types";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DefaultAttachmentsPanel() {
  const toast = useToast();
  const [attachments, setAttachments] = useState<DefaultAttachment[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setAttachments(await api.listAttachments());
    } catch (e) {
      toast.push({ variant: "error", title: "Couldn't load attachments", description: (e as Error).message });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.push({ variant: "error", title: "File too large", description: "Max 10MB per attachment." });
      return;
    }

    setUploading(true);
    try {
      const created = await api.uploadAttachment(file);
      setAttachments((prev) => [...(prev ?? []), created]);
      toast.push({ variant: "success", title: "Attachment added" });
    } catch (e) {
      toast.push({ variant: "error", title: "Couldn't add attachment", description: (e as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function toggleIncluded(id: string, includeByDefault: boolean) {
    setAttachments((prev) => prev?.map((a) => (a.id === id ? { ...a, includeByDefault } : a)) ?? null);
    try {
      await api.updateAttachment(id, { includeByDefault });
    } catch (e) {
      setAttachments((prev) => prev?.map((a) => (a.id === id ? { ...a, includeByDefault: !includeByDefault } : a)) ?? null);
      toast.push({ variant: "error", title: "Couldn't update attachment", description: (e as Error).message });
    }
  }

  async function handleDelete() {
    if (!pendingDeleteId) return;
    setDeleting(true);
    try {
      await api.deleteAttachment(pendingDeleteId);
      setAttachments((prev) => prev?.filter((a) => a.id !== pendingDeleteId) ?? null);
    } catch (e) {
      toast.push({ variant: "error", title: "Couldn't remove attachment", description: (e as Error).message });
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-gray-400" />
          <h3 className="text-[15px] font-bold text-ink">Default attachments</h3>
        </div>
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} loading={uploading}>
          <Plus className="size-3.5" />
          Add file
        </Button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
      </div>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Separate from your email signature. Files toggled on here are automatically attached to newly sent emails and
        follow-ups — never inserted inline, and never re-sent twice on a retry.
      </p>

      <div className="mt-4">
        {attachments === null ? (
          <p className="py-6 text-center text-xs text-gray-400">Loading…</p>
        ) : attachments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-[13px] text-gray-500">No default attachments yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{a.filename}</p>
                  <p className="text-[11px] text-gray-400">{formatBytes(a.sizeBytes)}</p>
                </div>
                <Switch
                  checked={a.includeByDefault}
                  onChange={(v) => toggleIncluded(a.id, v)}
                  ariaLabel={`Include ${a.filename} by default`}
                />
                <button
                  onClick={() => setPendingDeleteId(a.id)}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove attachment"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {uploading && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
            <Loader2 className="size-3 animate-spin" />
            Uploading…
          </p>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(o) => !o && setPendingDeleteId(null)}
        title="Remove this attachment?"
        description="It will no longer be included on future sends. This cannot be undone."
        confirmLabel="Remove"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
