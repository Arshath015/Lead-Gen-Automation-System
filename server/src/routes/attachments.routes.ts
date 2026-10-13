import { Router } from "express";
import multer from "multer";
import { defaultAttachmentsRepository } from "../db/defaultAttachmentsRepository";
import { uploadErrorMessage } from "./uploadUtil";

export const attachmentsRouter = Router();

// Common office/document/archive/image types a sales rep would plausibly
// attach (one-pagers, decks, spreadsheets, PDFs). Deliberately excludes
// executables and script types (.exe, .bat, .sh, .js, etc.) — this list is
// an allowlist, not a blocklist, so anything not explicitly safe is rejected
// by default rather than needing to be blocked by name.
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);
// Per-file cap. Resend's overall email size limit is 40MB including the
// message itself; this leaves headroom for multiple attachments plus a
// signature image on the same send (enforced in aggregate at send time by
// composeEmailBody's attachment budget check).
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
      cb(new Error(`Unsupported file type: ${file.mimetype || "unknown"}`));
      return;
    }
    cb(null, true);
  },
});

attachmentsRouter.get("/", async (_req, res) => {
  res.json(await defaultAttachmentsRepository.listAll());
});

attachmentsRouter.post("/", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err, MAX_ATTACHMENT_BYTES) });
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const attachment = await defaultAttachmentsRepository.create(req.file.originalname, req.file.mimetype, req.file.buffer);
    res.status(201).json(attachment);
  });
});

attachmentsRouter.patch("/:id", async (req, res) => {
  const { includeByDefault } = req.body ?? {};
  if (typeof includeByDefault !== "boolean") {
    return res.status(400).json({ error: "includeByDefault (boolean) is required" });
  }
  const updated = await defaultAttachmentsRepository.update(req.params.id, { includeByDefault });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

attachmentsRouter.delete("/:id", async (req, res) => {
  const ok = await defaultAttachmentsRepository.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});
