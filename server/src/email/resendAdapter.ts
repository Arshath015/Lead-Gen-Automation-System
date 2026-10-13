import { Resend } from "resend";
import type { Attachment } from "resend";
import { env } from "../config/env";
import { automationSettingsRepository } from "../db/automationSettingsRepository";
import { signatureAssetsRepository } from "../db/signatureAssetsRepository";
import { defaultAttachmentsRepository } from "../db/defaultAttachmentsRepository";
import { htmlToPlainText, sanitizeSignatureHtml } from "./sanitizeHtml";
import type { EmailSendResult, IEmailAdapter } from "./IEmailAdapter";

const client = new Resend(env.resendApiKey);

// Resend's documented cap is 40MB per email including the message itself.
// Attachments are checked against a lower budget, leaving headroom for
// headers/body/signature HTML so a send fails with a clear error from us
// instead of an opaque rejection from the API.
const ATTACHMENT_BUDGET_BYTES = 35 * 1024 * 1024;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Recognizes the one deliberate exception to "the body is plain text":
// markdown-style [label](url) links. Matched against the already-escaped
// paragraph text, so it can't be used to smuggle arbitrary HTML — only this
// exact bracket/paren shape, with an http(s) href, becomes a real anchor tag
// that Resend can rewrite for click tracking. Everything else in the body
// stays inert, escaped text.
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

// The draft body is always plain text (AI-generated or hand-edited); this is
// only ever used to build the html alternative of an outgoing email, never
// stored anywhere.
function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p>${escapeHtml(para)
          .replace(/\n/g, "<br>")
          .replace(MARKDOWN_LINK, (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)}</p>`
    )
    .join("\n");
}

// Shown when no real signature is saved, so a generated draft (which no
// longer includes any sign-off itself — see groqAdapter's prompts) doesn't
// end abruptly. This exact fallback is used for both the real send and the
// preview endpoint, so what the user previews always matches what's sent.
const FALLBACK_SIGNATURE_HTML = "<p>[Your Name]</p>";

const IMG_WITH_ASSET_ID = /<img\b[^>]*\bdata-signature-asset-id="([a-zA-Z0-9-]+)"[^>]*>/g;

// Resolves every <img data-signature-asset-id="..."> tag in the signature
// against its uploaded SignatureImageAsset. When `embedForSend` is true (the
// real outgoing email), each tag's src is rewritten to `cid:sig-{assetId}`
// and the image bytes are returned as an inline Resend attachment — this is
// Resend's documented mechanism for inline images (a normal <img src="...">
// pointing at our own server would be unreachable from the recipient's mail
// client, and most clients strip/block data: URIs). When false (the in-app
// draft/signature preview), the tag is left exactly as authored — its src
// already points at GET /api/signature-images/:id, which the browser can
// render directly — while the same attachment bytes/metadata are still
// resolved and returned so the preview can show "N image(s) attached"
// alongside a visually identical rendering of the exact same image.
// A reference to an asset that's since been deleted is dropped from the sent
// HTML (embedForSend) rather than left as a broken image or throwing and
// blocking the whole send.
async function resolveSignatureImages(signatureHtml: string, embedForSend: boolean): Promise<{ html: string; attachments: Attachment[] }> {
  const attachments: Attachment[] = [];
  if (!signatureHtml) return { html: signatureHtml, attachments };

  let html = signatureHtml;
  for (const match of signatureHtml.matchAll(IMG_WITH_ASSET_ID)) {
    const [fullTag, assetId] = match;
    const asset = await signatureAssetsRepository.readWithContent(assetId);
    if (!asset) {
      if (embedForSend) html = html.replace(fullTag, "");
      continue;
    }
    const cid = `sig-${asset.id}`;
    attachments.push({ content: asset.content, filename: asset.filename, contentType: asset.contentType, contentId: cid });
    if (embedForSend) {
      const rewritten = fullTag.replace(/\ssrc="[^"]*"/, ` src="cid:${cid}"`);
      html = html.replace(fullTag, rewritten);
    }
  }
  return { html, attachments };
}

// Attachments the user has opted to include on every new send by default
// (Settings > Default attachments) — read fresh on every call, same as the
// signature itself, so toggling one off takes effect immediately and a
// retried send recomputes (rather than duplicates) the exact same set.
async function loadDefaultAttachments(): Promise<Attachment[]> {
  const included = await defaultAttachmentsRepository.listIncluded();
  const attachments: Attachment[] = [];
  for (const item of included) {
    const content = await defaultAttachmentsRepository.readContent(item.id);
    if (!content) continue; // Metadata exists but the blob is missing on disk — skip defensively.
    attachments.push({ content, filename: item.filename, contentType: item.contentType });
  }
  return attachments;
}

function enforceAttachmentBudget(attachments: Attachment[]): void {
  const totalBytes = attachments.reduce((sum, a) => sum + (Buffer.isBuffer(a.content) ? a.content.length : 0), 0);
  if (totalBytes > ATTACHMENT_BUDGET_BYTES) {
    throw new Error(
      `Combined attachments (${Math.round(totalBytes / (1024 * 1024))}MB) exceed the ${Math.round(
        ATTACHMENT_BUDGET_BYTES / (1024 * 1024)
      )}MB budget for a single email — remove or disable some default attachments.`
    );
  }
}

// Combines the plain-text draft body with the rich-HTML signature into text
// and html versions of the outgoing email, plus the full set of attachments
// (inline signature images + selected default attachments) — computed fresh
// from the stable, unsigned base body on every call. The signature is never
// written back into a draft's stored body, so this is the single point every
// send (manual, automated, follow-up) passes through, and no caller can ever
// duplicate it by editing/regenerating/retrying a draft.
export async function composeEmailBody(
  body: string,
  signatureHtml: string,
  opts: { forSend?: boolean } = {}
): Promise<{ text: string; html: string; attachments: Attachment[] }> {
  const forSend = opts.forSend ?? true;
  // Sanitized again defensively even though it's already sanitized at save
  // time — this is the point where it actually reaches a real outgoing email.
  const sanitized = sanitizeSignatureHtml(signatureHtml || "");
  const signature = sanitized || FALLBACK_SIGNATURE_HTML;
  const signaturePlainText = htmlToPlainText(signature);

  const { html: signatureHtmlOut, attachments: signatureAttachments } = await resolveSignatureImages(signature, forSend);
  const defaultAttachments = await loadDefaultAttachments();
  const attachments = [...signatureAttachments, ...defaultAttachments];
  if (forSend) enforceAttachmentBudget(attachments);

  return {
    text: signaturePlainText ? `${body}\n\n${signaturePlainText}` : body,
    html: `${plainTextToHtml(body)}\n<div>${signatureHtmlOut}</div>`,
    attachments,
  };
}

// Builds the raw In-Reply-To/References email headers Resend passes through
// verbatim to the underlying provider. Pure and exported so header shape can
// be tested without a real Resend client. References is space-joined per
// RFC 5322 (a list of Message-IDs, most recent last); returns undefined when
// neither is present so callers can omit the `headers` key entirely rather
// than sending an empty object.
export function buildThreadingEmailHeaders(opts: { inReplyTo?: string; references?: string[] }): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references && opts.references.length > 0) headers["References"] = opts.references.join(" ");
  return Object.keys(headers).length > 0 ? headers : undefined;
}

// Fetches the raw headers of an inbound reply Resend received, by its own
// email_id (from the "email.received" webhook payload). This is a separate,
// read-only GET call — the webhook payload itself never carries headers or
// an IP at all, only this dedicated endpoint does (see
// GetReceivingEmailResponseSuccess in the resend package's types). Fails
// closed to null on any error (network failure, unknown id, API error) so a
// lookup failure degrades to "no location available" rather than breaking
// webhook processing.
export async function fetchReceivedEmailHeaders(emailId: string): Promise<Record<string, string> | null> {
  try {
    const { data, error } = await client.emails.receiving.get(emailId);
    if (error || !data) return null;
    return data.headers ?? null;
  } catch {
    return null;
  }
}

export const resendAdapter: IEmailAdapter = {
  name: "resend",

  async send({ to, subject, body, idempotencyKey, inReplyTo, references }): Promise<EmailSendResult> {
    const settings = await automationSettingsRepository.get();
    const { text, html, attachments } = await composeEmailBody(body, settings.emailSignature);
    const headers = buildThreadingEmailHeaders({ inReplyTo, references });
    const { data, error } = await client.emails.send(
      {
        from: env.emailFrom,
        to,
        subject,
        text,
        html,
        ...(attachments.length > 0 ? { attachments } : {}),
        // Routes replies to the configured inbound address instead of
        // EMAIL_FROM, so they land on whatever domain is actually set up to
        // receive mail in Resend. No-op until RESEND_REPLY_TO is configured.
        ...(env.resendReplyTo ? { replyTo: env.resendReplyTo } : {}),
        ...(headers ? { headers } : {}),
      },
      // Lets a crash-and-retry of the same send attempt reuse the same
      // Resend request instead of dispatching a second email — Resend
      // recognizes the repeated Idempotency-Key and returns the original result.
      idempotencyKey ? { idempotencyKey } : undefined
    );

    if (error) {
      throw new Error(`Resend API error (${error.name}): ${error.message}`);
    }

    return { id: data.id };
  },
};
