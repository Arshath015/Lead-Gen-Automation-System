import path from "path";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, attachmentsTable, usersTable, leadsTable, auditLogsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "../lib/permissions";
import { wsFilter } from "../lib/workspaceScope";

// ── File upload security ──────────────────────────────────────────────────────

/** Allowed MIME types for upload. Add more as needed. */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** Max upload: 20 MB expressed as base64 chars (base64 is ~4/3 of binary size) */
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_LEN = Math.ceil(MAX_FILE_SIZE_BYTES * 4 / 3) + 4; // +4 for padding

/**
 * Sanitize a filename:
 * - Strip path components (path traversal prevention)
 * - Remove null bytes and control characters
 * - Truncate to 255 chars
 */
function sanitizeFileName(name: string): string {
  const base = path.basename(name);
  return base
    .replace(/[\x00-\x1f\x7f]/g, "")  // control chars
    .replace(/[<>:"/\\|?*]/g, "_")      // unsafe filesystem chars
    .slice(0, 255)
    .trim() || "file";
}

const AttachmentInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative().max(MAX_FILE_SIZE_BYTES).optional(),
  mimeType: z.string().max(100).optional(),
  fileData: z.string().min(1).max(MAX_BASE64_LEN),
});

const router: IRouter = Router();

/**
 * Verify that the given leadId belongs to the authenticated user's workspace.
 * Returns the lead row on success, or null if not found / cross-workspace.
 */
async function resolveLeadInWorkspace(leadId: number, wid: number | null) {
  const [lead] = await db.select({ id: leadsTable.id, workspaceId: leadsTable.workspaceId })
    .from(leadsTable)
    .where(and(eq(leadsTable.id, leadId), wsFilter(leadsTable.workspaceId, wid)));
  return lead ?? null;
}

async function logAudit(userId: number | null, action: string, workspaceId: number | null, details?: string, ipAddress?: string) {
  await db.insert(auditLogsTable).values({
    leadId: null, userId, action, tableName: "attachments", fieldName: null,
    oldValue: null, newValue: details ?? null, ipAddress: ipAddress ?? null, workspaceId,
  }).catch(() => {});
}

// ── List attachments for a lead ───────────────────────────────────────────────

router.get("/leads/:leadId/attachments", requirePermission("files.download"), async (req: Request, res: Response) => {
  const leadId = Number(req.params.leadId);
  if (!Number.isFinite(leadId)) { res.status(400).json({ error: "Invalid lead id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  // IDOR guard — reject requests for leads that don't belong to this workspace
  const lead = await resolveLeadInWorkspace(leadId, wid);
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db.select().from(attachmentsTable)
    .where(eq(attachmentsTable.leadId, leadId))
    .orderBy(desc(attachmentsTable.createdAt));

  const result = await Promise.all(rows.map(async (a) => {
    const [uploader] = a.uploadedById
      ? await db.select().from(usersTable).where(eq(usersTable.numId, a.uploadedById))
      : [null];
    return {
      id: a.id,
      leadId: a.leadId,
      fileName: a.fileName,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      uploadedById: a.uploadedById,
      uploadedByName: uploader
        ? (`${uploader.firstName ?? ""} ${uploader.lastName ?? ""}`.trim() || uploader.email?.split("@")[0] || null)
        : null,
      createdAt: a.createdAt.toISOString(),
    };
  }));
  res.json(result);
});

// ── Upload an attachment for a lead ──────────────────────────────────────────

router.post("/leads/:leadId/attachments", requirePermission("files.upload"), async (req: Request, res: Response) => {
  const leadId = Number(req.params.leadId);
  if (!Number.isFinite(leadId)) { res.status(400).json({ error: "Invalid lead id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  // IDOR guard — reject uploads targeting leads outside this workspace
  const lead = await resolveLeadInWorkspace(leadId, wid);
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  const parsed = AttachmentInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // MIME type validation — reject disallowed types
  const mime = parsed.data.mimeType?.toLowerCase() ?? "";
  if (mime && !ALLOWED_MIME_TYPES.has(mime)) {
    res.status(415).json({ error: `File type "${mime}" is not allowed. Please upload a supported file type.` });
    return;
  }

  // Validate that fileData looks like a valid base64 string (no script injection)
  const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
  const rawData = parsed.data.fileData.replace(/^data:[^;]+;base64,/, "");
  if (!base64Pattern.test(rawData)) {
    res.status(400).json({ error: "Invalid file data encoding" });
    return;
  }

  const safeFileName = sanitizeFileName(parsed.data.fileName);

  const [row] = await db.insert(attachmentsTable).values({
    leadId,
    fileName: safeFileName,
    fileSize: parsed.data.fileSize,
    mimeType: parsed.data.mimeType,
    fileData: parsed.data.fileData,
    uploadedById: req.user!.id,
  }).returning();

  await logAudit(req.user!.id, "upload", wid, `Uploaded "${safeFileName}" to lead ${leadId}`, req.ip ?? undefined);

  const [uploader] = await db.select().from(usersTable).where(eq(usersTable.numId, req.user!.id));
  res.status(201).json({
    id: row.id,
    leadId: row.leadId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    uploadedById: row.uploadedById,
    uploadedByName: uploader
      ? (`${uploader.firstName ?? ""} ${uploader.lastName ?? ""}`.trim() || uploader.email?.split("@")[0] || null)
      : null,
    createdAt: row.createdAt.toISOString(),
  });
});

// ── Download an attachment ────────────────────────────────────────────────────

router.get("/attachments/:id/download", requirePermission("files.download"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  // Fetch the attachment and its lead in one query to verify workspace ownership
  const [row] = await db.select({ attachment: attachmentsTable, leadWorkspaceId: leadsTable.workspaceId })
    .from(attachmentsTable)
    .leftJoin(leadsTable, eq(attachmentsTable.leadId, leadsTable.id))
    .where(eq(attachmentsTable.id, id));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // IDOR guard — ensure the attachment's lead belongs to this workspace
  if (wid !== null && row.leadWorkspaceId !== wid) {
    res.status(404).json({ error: "Not found" }); return;
  }

  res.json({ fileData: row.attachment.fileData, fileName: row.attachment.fileName, mimeType: row.attachment.mimeType });
});

// ── Delete an attachment ──────────────────────────────────────────────────────

router.delete("/attachments/:id", requirePermission("files.delete"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  // Fetch + workspace ownership check in one join
  const [row] = await db.select({ attachment: attachmentsTable, leadWorkspaceId: leadsTable.workspaceId })
    .from(attachmentsTable)
    .leftJoin(leadsTable, eq(attachmentsTable.leadId, leadsTable.id))
    .where(eq(attachmentsTable.id, id));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // IDOR guard
  if (wid !== null && row.leadWorkspaceId !== wid) {
    res.status(404).json({ error: "Not found" }); return;
  }

  await db.delete(attachmentsTable).where(eq(attachmentsTable.id, id));
  await logAudit(req.user!.id, "delete", wid, `Deleted attachment ${id} ("${row.attachment.fileName}")`, req.ip ?? undefined);
  res.status(204).send();
});

export default router;
