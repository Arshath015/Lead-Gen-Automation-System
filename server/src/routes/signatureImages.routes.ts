import { Router } from "express";
import multer from "multer";
import { signatureAssetsRepository } from "../db/signatureAssetsRepository";
import { uploadErrorMessage } from "./uploadUtil";

export const signatureImagesRouter = Router();

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// Generous for a signature logo/headshot while keeping the composed email
// light — this is an inline CID attachment added to every send that uses it.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(new Error(`Unsupported image type: ${file.mimetype}. Use PNG, JPEG, GIF, or WEBP.`));
      return;
    }
    cb(null, true);
  },
});

signatureImagesRouter.post("/", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err, MAX_IMAGE_BYTES) });
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const asset = await signatureAssetsRepository.create(req.file.originalname, req.file.mimetype, req.file.buffer);
    res.status(201).json({
      id: asset.id,
      url: `/api/signature-images/${asset.id}`,
      filename: asset.filename,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
    });
  });
});

// Serves the raw image bytes — used as the <img src> in the signature editor
// and in the (non-sending) draft preview. Never used for the actual outgoing
// email, which embeds the same bytes as a cid: inline attachment instead
// (see composeEmailBody in resendAdapter.ts) since a recipient's mail client
// can't reach back into this server to fetch it.
signatureImagesRouter.get("/:id", async (req, res) => {
  const asset = await signatureAssetsRepository.readWithContent(req.params.id);
  if (!asset) return res.status(404).end();
  res.setHeader("Content-Type", asset.contentType);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(asset.content);
});

signatureImagesRouter.delete("/:id", async (req, res) => {
  const ok = await signatureAssetsRepository.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});
