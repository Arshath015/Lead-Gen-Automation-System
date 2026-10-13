import { Router, type IRouter, type Request, type Response } from "express";
import { db, stagesTable } from "@workspace/db";
import { asc, and, eq, isNull } from "drizzle-orm";
import { requirePermission } from "../lib/permissions";
import {
  CreateStageBody,
  UpdateStageParams,
  UpdateStageBody,
  DeleteStageParams,
  ReorderStagesBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stages", requirePermission("pipeline.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const stageType = (req.query.type as string | undefined) ?? null;

  // Deal stages are seeded globally (workspaceId = NULL) so they are shared
  // across all workspaces. When filtering by type=deal, scope to NULL workspace
  // instead of the user's workspace to ensure they are returned correctly.
  const wsCondition = (stageType === "deal")
    ? isNull(stagesTable.workspaceId)
    : (wid !== null ? eq(stagesTable.workspaceId, wid) : isNull(stagesTable.workspaceId));
  const typeCondition = stageType ? eq(stagesTable.type, stageType) : null;
  const whereClause = typeCondition ? and(wsCondition, typeCondition) : wsCondition;

  const stages = await db.select().from(stagesTable)
    .where(whereClause)
    .orderBy(asc(stagesTable.order));
  res.json(stages);
});

router.post("/stages", requirePermission("settings.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = CreateStageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;
  const [stage] = await db.insert(stagesTable).values({ ...parsed.data, isDefault: false, workspaceId: wid }).returning();
  res.status(201).json(stage);
});

router.patch("/stages/reorder", requirePermission("settings.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = ReorderStagesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const updates = parsed.data.stageIds.map((id, idx) =>
    db.update(stagesTable).set({ order: idx }).where(eq(stagesTable.id, id))
  );
  await Promise.all(updates);
  const wid2 = req.user.workspaceId ?? null;
  const stages = await db.select().from(stagesTable)
    .where(wid2 !== null ? eq(stagesTable.workspaceId, wid2) : isNull(stagesTable.workspaceId))
    .orderBy(asc(stagesTable.order));
  res.json(stages);
});

router.patch("/stages/:id", requirePermission("settings.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const params = UpdateStageParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateStageBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [stage] = await db.update(stagesTable).set(body.data).where(eq(stagesTable.id, params.data.id)).returning();
  if (!stage) { res.status(404).json({ error: "Not found" }); return; }
  res.json(stage);
});

router.delete("/stages/:id", requirePermission("settings.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const params = DeleteStageParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [stage] = await db.select().from(stagesTable).where(eq(stagesTable.id, params.data.id));
  if (stage?.isDefault) { res.status(400).json({ error: "Cannot delete default stage" }); return; }
  await db.delete(stagesTable).where(eq(stagesTable.id, params.data.id));
  res.status(204).send();
});

export default router;
