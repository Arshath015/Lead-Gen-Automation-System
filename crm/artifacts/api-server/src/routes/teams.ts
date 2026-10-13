import { Router, type IRouter, type Request, type Response } from "express";
import { db, teamsTable, teamMembersTable, usersTable, auditLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission, guardSuperAdmin } from "../lib/permissions";

const router: IRouter = Router();

async function teamToDto(team: typeof teamsTable.$inferSelect) {
  const memberRows = await db.select({ userId: teamMembersTable.userId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, team.id));
  const memberIds = memberRows.map(r => r.userId);

  let managerName: string | null = null;
  if (team.managerId) {
    const [mgr] = await db.select().from(usersTable).where(eq(usersTable.numId, team.managerId));
    if (mgr) {
      managerName = `${mgr.firstName ?? ""} ${mgr.lastName ?? ""}`.trim() || mgr.email?.split("@")[0] || null;
    }
  }

  return {
    id: team.id,
    name: team.name,
    managerId: team.managerId ?? null,
    managerName,
    memberIds,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

router.get("/teams", requirePermission("users.view"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const teams = await db.select().from(teamsTable).where(wsFilter(teamsTable.workspaceId, wid));
  const dtos = await Promise.all(teams.map(teamToDto));
  res.json(dtos);
});

router.post("/teams", requirePermission("users.edit"), async (req: Request, res: Response) => {
  const { name, managerId } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const wid = req.user!.workspaceId ?? null;
  const [team] = await db.insert(teamsTable).values({ name, managerId: managerId ?? null, workspaceId: wid }).returning();
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "created",
    tableName: "teams",
    fieldName: "name",
    newValue: name,
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(await teamToDto(team));
});

router.get("/teams/:id", requirePermission("users.view"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;
  const [team] = await db.select().from(teamsTable)
    .where(and(eq(teamsTable.id, id), wsFilter(teamsTable.workspaceId, wid)));
  if (!team) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await teamToDto(team));
});

router.patch("/teams/:id", requirePermission("users.edit"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;
  const [existing] = await db.select().from(teamsTable)
    .where(and(eq(teamsTable.id, id), wsFilter(teamsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const { name, managerId } = req.body;
  const updateData: Partial<typeof teamsTable.$inferInsert> = {};
  if (name !== undefined) updateData.name = name;
  if (managerId !== undefined) updateData.managerId = managerId;
  const [team] = await db.update(teamsTable).set(updateData).where(eq(teamsTable.id, id)).returning();
  if (!team) { res.status(404).json({ error: "Not found" }); return; }
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "updated",
    tableName: "teams",
    fieldName: Object.keys(updateData).join(","),
    oldValue: JSON.stringify({ name: existing.name, managerId: existing.managerId }),
    newValue: JSON.stringify(updateData),
    ipAddress: req.ip ?? null,
  });
  res.json(await teamToDto(team));
});

router.delete("/teams/:id", requirePermission("users.delete"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;
  const [existing] = await db.select().from(teamsTable)
    .where(and(eq(teamsTable.id, id), wsFilter(teamsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(teamsTable).where(eq(teamsTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "deleted",
    tableName: "teams",
    fieldName: "name",
    oldValue: existing.name,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
});

router.post("/teams/:id/members", requirePermission("users.edit"), async (req: Request, res: Response) => {
  const teamId = Number(req.params.id);
  const { userId } = req.body;
  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }
  if (!(await guardSuperAdmin(req, res, Number(userId)))) return;
  await db.insert(teamMembersTable).values({ teamId, userId }).onConflictDoNothing();
  await db.update(usersTable).set({ teamId }).where(eq(usersTable.numId, userId));
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "updated",
    tableName: "team_members",
    fieldName: "member_added",
    newValue: `userId:${userId} → teamId:${teamId}`,
    ipAddress: req.ip ?? null,
  });
  res.status(201).json({ teamId, userId });
});

router.delete("/teams/:id/members/:userId", requirePermission("users.edit"), async (req: Request, res: Response) => {
  const teamId = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!(await guardSuperAdmin(req, res, userId))) return;
  await db.delete(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, userId)));
  await db.update(usersTable).set({ teamId: null })
    .where(eq(usersTable.numId, userId));
  await db.insert(auditLogsTable).values({
    userId: req.user!.id,
    action: "updated",
    tableName: "team_members",
    fieldName: "member_removed",
    oldValue: `userId:${userId} → teamId:${teamId}`,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
});

export default router;
