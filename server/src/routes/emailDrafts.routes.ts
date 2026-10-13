import { Router } from "express";
import { emailDraftsRepository } from "../db/emailDraftsRepository";
import { leadActivityRepository } from "../db/leadActivityRepository";
import { automationSettingsRepository } from "../db/automationSettingsRepository";
import { generateDraftForLead, sendDraftForLead } from "../services/emailPipeline";
import { composeEmailBody } from "../email/resendAdapter";
import type { EmailDraft } from "../types/email";

export const emailDraftsRouter = Router();

emailDraftsRouter.get("/", async (req, res) => {
  const leadIds = String(req.query.leadIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (leadIds.length === 0) return res.json([]);
  const drafts = await emailDraftsRepository.getByLeadIds(leadIds);
  res.json(drafts);
});

emailDraftsRouter.get("/:leadId", async (req, res) => {
  const draft = await emailDraftsRepository.getByLeadId(req.params.leadId);
  if (!draft) return res.status(404).json({ error: "Not found" });
  res.json(draft);
});

// Returns exactly what sending would produce (body + real or fallback
// signature, as both text and html, plus the attachments that would go out)
// by calling the same composeEmailBody function the real send path uses —
// so the preview can never drift from the actual outgoing email. Called with
// forSend: false so inline signature image tags keep their normal,
// browser-renderable src (GET /api/signature-images/:id) instead of the
// cid: reference the real send uses — same bytes, same visual result,
// just addressed differently since this response is rendered directly in
// our own app, not delivered by an email client.
emailDraftsRouter.get("/:leadId/preview", async (req, res) => {
  const draft = await emailDraftsRepository.getByLeadId(req.params.leadId);
  if (!draft) return res.status(404).json({ error: "Not found" });
  const settings = await automationSettingsRepository.get();
  const composed = await composeEmailBody(draft.body, settings.emailSignature, { forSend: false });
  res.json({
    text: composed.text,
    html: composed.html,
    // Metadata only — raw attachment bytes never need to round-trip to the
    // browser just to show "N attachment(s) will be sent".
    attachments: composed.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: Buffer.isBuffer(a.content) ? a.content.length : 0,
      inline: !!a.contentId,
    })),
  });
});

emailDraftsRouter.patch("/:leadId", async (req, res) => {
  const updated = await emailDraftsRepository.update(req.params.leadId, {
    ...(req.body ?? {}),
    editedByUser: true,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  await leadActivityRepository.record(req.params.leadId, "draft_edited", `Draft edited: "${updated.subject}"`);
  res.json(updated);
});

emailDraftsRouter.post("/:leadId/generate", async (req, res) => {
  const force = Boolean(req.body?.force);
  try {
    const draft = await generateDraftForLead(req.params.leadId, force);
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

emailDraftsRouter.post("/generate-bulk", async (req, res) => {
  const { leadIds, force } = req.body ?? {};
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: "leadIds[] is required" });
  }

  const results: { leadId: string; draft?: EmailDraft; error?: string }[] = [];
  for (const leadId of leadIds) {
    try {
      const draft = await generateDraftForLead(leadId, Boolean(force));
      results.push({ leadId, draft });
    } catch (err) {
      results.push({ leadId, error: (err as Error).message });
    }
  }

  res.json({ results });
});

emailDraftsRouter.post("/:leadId/send", async (req, res) => {
  const force = Boolean(req.body?.force);
  try {
    const draft = await sendDraftForLead(req.params.leadId, force);
    res.json(draft);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

emailDraftsRouter.post("/send-bulk", async (req, res) => {
  const { leadIds, force } = req.body ?? {};
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: "leadIds[] is required" });
  }

  const results: { leadId: string; draft?: EmailDraft; error?: string }[] = [];
  for (const leadId of leadIds) {
    try {
      const draft = await sendDraftForLead(leadId, Boolean(force));
      results.push({ leadId, draft });
    } catch (err) {
      results.push({ leadId, error: (err as Error).message });
    }
  }

  res.json({ results });
});
