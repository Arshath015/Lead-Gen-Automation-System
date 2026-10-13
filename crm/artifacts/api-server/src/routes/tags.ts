import { Router, type IRouter, type Request, type Response } from "express";
import { db, tagsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

router.get("/tags", requirePermission("leads.view"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const tags = await db.select().from(tagsTable).where(wsFilter(tagsTable.workspaceId, wid)).orderBy(tagsTable.name);
  res.json(tags);
});

router.post("/tags", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  const { name, color } = req.body;
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }
  const wid = req.user!.workspaceId ?? null;
  try {
    const [tag] = await db.insert(tagsTable).values({ name, color: color ?? "#6366f1", workspaceId: wid }).returning();
    res.status(201).json(tag);
  } catch {
    res.status(409).json({ error: "Tag name already exists" });
  }
});

router.patch("/tags/:id", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;
  const { name, color } = req.body;
  const update: Record<string, string> = {};
  if (name) update.name = name;
  if (color) update.color = color;
  const [tag] = await db.update(tagsTable).set(update)
    .where(and(eq(tagsTable.id, id), wsFilter(tagsTable.workspaceId, wid)))
    .returning();
  if (!tag) { res.status(404).json({ error: "Not found" }); return; }
  res.json(tag);
});

router.delete("/tags/:id", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;
  await db.delete(tagsTable).where(and(eq(tagsTable.id, id), wsFilter(tagsTable.workspaceId, wid)));
  res.status(204).send();
});

export default router;
