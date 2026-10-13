import { Router, type IRouter, type Request, type Response } from "express";
import { db, emailTemplatesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

function isAdmin(req: Request): boolean {
  return req.isAuthenticated() && req.user.role === "admin";
}

function serialize(t: typeof emailTemplatesTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get("/email-templates", requirePermission("email_templates.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const includeInactive = req.query.includeInactive === "true" && isAdmin(req);

  const rows = includeInactive
    ? await db.select().from(emailTemplatesTable).where(wsFilter(emailTemplatesTable.workspaceId, wid)).orderBy(desc(emailTemplatesTable.createdAt))
    : await db.select().from(emailTemplatesTable)
        .where(and(eq(emailTemplatesTable.isActive, true), wsFilter(emailTemplatesTable.workspaceId, wid)))
        .orderBy(desc(emailTemplatesTable.createdAt));

  res.json(rows.map(serialize));
});

router.post("/email-templates", requirePermission("email_templates.edit"), async (req: Request, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, subject, body, isActive } = req.body;
  if (!name?.trim() || !subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: "name, subject, and body are required" });
    return;
  }
  const wid = req.user?.workspaceId ?? null;
  const [tpl] = await db.insert(emailTemplatesTable).values({
    name: name.trim(),
    subject: subject.trim(),
    body: body.trim(),
    isActive: isActive !== false,
    createdById: req.user?.id ?? null,
    workspaceId: wid,
  }).returning();
  res.status(201).json(serialize(tpl));
});

router.patch("/email-templates/:id", requirePermission("email_templates.edit"), async (req: Request, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user?.workspaceId ?? null;
  const { name, subject, body, isActive } = req.body;
  const updates: Partial<typeof emailTemplatesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name.trim();
  if (subject !== undefined) updates.subject = subject.trim();
  if (body !== undefined) updates.body = body.trim();
  if (isActive !== undefined) updates.isActive = isActive;

  const [tpl] = await db
    .update(emailTemplatesTable)
    .set(updates)
    .where(and(eq(emailTemplatesTable.id, id), wsFilter(emailTemplatesTable.workspaceId, wid)))
    .returning();
  if (!tpl) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serialize(tpl));
});

router.delete("/email-templates/:id", requirePermission("email_templates.edit"), async (req: Request, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user?.workspaceId ?? null;
  const deleted = await db
    .delete(emailTemplatesTable)
    .where(and(eq(emailTemplatesTable.id, id), wsFilter(emailTemplatesTable.workspaceId, wid)))
    .returning();
  if (!deleted.length) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

export default router;
