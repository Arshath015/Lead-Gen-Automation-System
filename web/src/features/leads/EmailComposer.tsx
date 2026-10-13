import { useEffect, useState } from "react";
import { PenLine, RotateCcw, Send, KeyRound, CheckCircle2, Paperclip } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { inputClass, textareaClass, labelClass } from "../../components/ui/field";
import { SendStatusBadge } from "./StatusBadges";
import { api } from "../../api/client";
import { useToast } from "../../lib/toast";
import { formatRelativeTime } from "../../lib/format";
import type { EmailDraft, EmailPreviewAttachment, Lead } from "../../types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  lead: Lead;
  draft: EmailDraft | null;
  researchComplete: boolean;
  emailFrom: string | null;
  onChanged: (draft: EmailDraft) => void;
}

export function EmailComposer({ lead, draft, researchComplete, emailFrom, onChanged }: Props) {
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmResend, setConfirmResend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signaturePreviewHtml, setSignaturePreviewHtml] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<EmailPreviewAttachment[]>([]);

  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBody(draft?.body ?? "");
  }, [draft?.id, draft?.updatedAt]);

  // Reflects the actual signature currently saved in Settings (or the same
  // [Your Name] fallback a real send would use) — fetched from the same
  // compose function the real send path uses, so this can never drift from
  // what actually goes out.
  useEffect(() => {
    if (!draft) {
      setSignaturePreviewHtml(null);
      setAttachmentPreview([]);
      return;
    }
    let cancelled = false;
    api
      .getEmailDraftPreview(lead.id)
      .then((preview) => {
        if (cancelled) return;
        // Preview includes the base body too; only the signature portion
        // (everything after the body) is shown here, since the body is
        // already editable above.
        const bodyHtml = preview.html.split("\n<div>")[0];
        const signatureHtml = preview.html.slice(bodyHtml.length);
        setSignaturePreviewHtml(signatureHtml || null);
        // Inline signature images already render visibly inside the
        // signature above — only list non-inline (regular default)
        // attachments here so nothing is shown twice.
        setAttachmentPreview(preview.attachments.filter((a) => !a.inline));
      })
      .catch(() => {
        setSignaturePreviewHtml(null);
        setAttachmentPreview([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lead.id, draft?.id, draft?.updatedAt]);

  const dirty = !!draft && (subject !== draft.subject || body !== draft.body);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const d = await api.generateEmailDraft(lead.id, !!draft);
      onChanged(d);
      toast.push({ variant: "success", title: "Draft generated" });
    } catch (e) {
      setError((e as Error).message);
      toast.push({ variant: "error", title: "Draft generation failed", description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const d = await api.updateEmailDraft(lead.id, { subject, body });
      onChanged(d);
      toast.push({ variant: "success", title: "Draft saved" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSend(force: boolean) {
    setSending(true);
    setError(null);
    try {
      const d = await api.sendEmailDraft(lead.id, force);
      onChanged(d);
      toast.push({ variant: "success", title: `Email sent to ${lead.email}` });
    } catch (e) {
      setError((e as Error).message);
      toast.push({ variant: "error", title: "Send failed", description: (e as Error).message });
    } finally {
      setSending(false);
      setConfirmResend(false);
    }
  }

  const canSend = !!draft && !!lead.email && !dirty;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Email</h3>
          <SendStatusBadge status={draft?.sendStatus} />
        </div>
        <Button size="sm" variant={draft ? "outline" : "secondary"} onClick={handleGenerate} loading={generating} disabled={!researchComplete}>
          {draft ? <RotateCcw className="size-3.5" /> : <PenLine className="size-3.5" />}
          {draft ? "Regenerate" : "Generate draft"}
        </Button>
      </div>

      {error && <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {!researchComplete && !draft && (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-[13px] text-gray-500">Run research first, then generate a draft.</p>
        </div>
      )}

      {researchComplete && !draft && !generating && (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-[13px] text-gray-500">No draft yet for this lead.</p>
        </div>
      )}

      {draft && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="space-y-2 border-b border-border-subtle bg-gray-50/60 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 text-gray-400">To</span>
              {lead.email ? (
                <span className="text-gray-700">{lead.email}</span>
              ) : (
                <span className="flex items-center gap-1 text-amber-600">
                  <KeyRound className="size-3" />
                  Email not revealed yet
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 text-gray-400">From</span>
              <span className="text-gray-700">{emailFrom ?? "—"}</span>
            </div>
          </div>

          <div className="space-y-2.5 px-3 py-3">
            <div>
              <label className={labelClass}>Subject</label>
              <input className={inputClass + " mt-1"} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Body</label>
              <textarea
                className={textareaClass + " mt-1"}
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            {signaturePreviewHtml && (
              <div>
                <label className={labelClass}>Signature (from Settings)</label>
                <div
                  className="signature-editor-content mt-1 rounded-lg border border-border-subtle bg-gray-50/60 px-3 py-2 text-[13px] text-ink"
                  dangerouslySetInnerHTML={{ __html: signaturePreviewHtml }}
                />
              </div>
            )}
            {attachmentPreview.length > 0 && (
              <div>
                <label className={labelClass}>Attachments (from Settings)</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {attachmentPreview.map((a) => (
                    <span
                      key={a.filename}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-gray-50/60 px-2.5 py-1 text-[11.5px] text-gray-600"
                    >
                      <Paperclip className="size-3 text-gray-400" />
                      {a.filename}
                      <span className="text-gray-400">{formatBytes(a.sizeBytes)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2.5">
            <p className="text-[11px] text-gray-400">
              {draft.sendStatus === "sent" && draft.sentAt
                ? `Sent ${formatRelativeTime(draft.sentAt)}`
                : draft.editedByUser
                ? "Edited"
                : `Generated ${formatRelativeTime(draft.generatedAt)}`}
              {draft.model ? ` · ${draft.model}` : ""}
            </p>
            <div className="flex items-center gap-1.5">
              {dirty && (
                <Button size="sm" variant="outline" onClick={handleSave} loading={saving}>
                  Save
                </Button>
              )}
              {draft.sendStatus === "sent" ? (
                <Button size="sm" variant="outline" onClick={() => setConfirmResend(true)} disabled={!canSend}>
                  <Send className="size-3.5" />
                  Resend
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => handleSend(false)} loading={sending} disabled={!canSend}>
                  {draft.sendStatus === "failed" ? <RotateCcw className="size-3.5" /> : <Send className="size-3.5" />}
                  {draft.sendStatus === "failed" ? "Retry send" : "Send"}
                </Button>
              )}
            </div>
          </div>

          {draft.sendStatus === "failed" && draft.sendError && (
            <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              Send failed: {draft.sendError}
            </div>
          )}
          {draft.sendStatus === "sent" && (
            <div className="flex items-center gap-1.5 border-t border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              <CheckCircle2 className="size-3.5" />
              Delivered to {lead.email}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmResend}
        onOpenChange={setConfirmResend}
        title="Resend this email?"
        description={`This email was already sent to ${lead.email}. Sending again will deliver a duplicate.`}
        confirmLabel="Resend anyway"
        loading={sending}
        onConfirm={() => handleSend(true)}
      />
    </div>
  );
}

