import { Router, type IRouter, type Request, type Response } from "express";
import { db, activitiesTable, leadsTable, usersTable } from "@workspace/db";
import { eq, desc, inArray, gte, lte, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { ListActivitiesParams, GetRecentActivitiesQueryParams } from "@workspace/api-zod";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";

const router: IRouter = Router();

async function canAccessLead(user: Express.User, lead: typeof leadsTable.$inferSelect): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role === "manager") {
    const allowedIds = await getAllowedOwnerIds(user as ScopeUser);
    if (allowedIds === null) return true;
    return lead.ownerId !== null && allowedIds.includes(lead.ownerId);
  }
  return lead.ownerId === user.id;
}

router.get("/leads/:leadId/activities", requirePermission("activities.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListActivitiesParams.safeParse({ leadId: Number(req.params.leadId) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessLead(req.user, lead))) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db.select({ activity: activitiesTable, user: usersTable })
    .from(activitiesTable)
    .leftJoin(usersTable, eq(activitiesTable.userId, usersTable.numId))
    .where(and(eq(activitiesTable.leadId, params.data.leadId), wsFilter(activitiesTable.workspaceId, wid)))
    .orderBy(desc(activitiesTable.createdAt));

  res.json(rows.map(r => ({
    ...r.activity,
    userName: r.user ? `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email?.split("@")[0] : null,
    userAvatar: r.user?.profileImageUrl ?? null,
    createdAt: r.activity.createdAt.toISOString(),
  })));
});

router.get("/activities/recent", requirePermission("activities.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const qp = GetRecentActivitiesQueryParams.safeParse(req.query);
  const limit = qp.success ? (qp.data.limit ?? 20) : 20;
  const wid = req.user.workspaceId ?? null;

  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  const from = typeof fromRaw === "string" && fromRaw ? new Date(fromRaw) : undefined;
  const to = typeof toRaw === "string" && toRaw ? new Date(toRaw) : undefined;
  const dateConds: any[] = [];
  if (from && !isNaN(from.getTime())) dateConds.push(gte(activitiesTable.createdAt, from));
  if (to && !isNaN(to.getTime())) dateConds.push(lte(activitiesTable.createdAt, to));

  const ownerIdParam = req.user.role !== "bd" && req.query.ownerId
    ? Number(req.query.ownerId)
    : undefined;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let scopedLeadIds: number[] | null = null;
  if (allowedOwnerIds !== null) {
    const baseOwnerIds = allowedOwnerIds.length === 0 ? [req.user.id] : allowedOwnerIds;
    const scopedLeads = await db.select({ id: leadsTable.id, ownerId: leadsTable.ownerId })
      .from(leadsTable)
      .where(and(inArray(leadsTable.ownerId, baseOwnerIds), wsFilter(leadsTable.workspaceId, wid)));
    let ids = scopedLeads.map(l => l.id);
    if (ownerIdParam !== undefined) {
      const repLeadIds = new Set(scopedLeads.filter(l => l.ownerId === ownerIdParam).map(l => l.id));
      ids = ids.filter(id => repLeadIds.has(id));
    }
    scopedLeadIds = ids;
  } else if (ownerIdParam !== undefined) {
    const repLeads = await db.select({ id: leadsTable.id }).from(leadsTable)
      .where(and(eq(leadsTable.ownerId, ownerIdParam), wsFilter(leadsTable.workspaceId, wid)));
    scopedLeadIds = repLeads.map(l => l.id);
  }

  let rows;
  const wsCond = wsFilter(activitiesTable.workspaceId, wid);
  if (scopedLeadIds === null) {
    const whereCond = dateConds.length > 0 ? and(wsCond, ...dateConds) : wsCond;
    rows = await db.select({ activity: activitiesTable, lead: leadsTable, user: usersTable })
      .from(activitiesTable)
      .leftJoin(leadsTable, eq(activitiesTable.leadId, leadsTable.id))
      .leftJoin(usersTable, eq(activitiesTable.userId, usersTable.numId))
      .where(whereCond)
      .orderBy(desc(activitiesTable.createdAt))
      .limit(limit);
  } else {
    if (scopedLeadIds.length === 0) { res.json([]); return; }
    const scopeCond = inArray(activitiesTable.leadId, scopedLeadIds);
    const whereCond = and(wsCond, scopeCond, ...dateConds);
    rows = await db.select({ activity: activitiesTable, lead: leadsTable, user: usersTable })
      .from(activitiesTable)
      .leftJoin(leadsTable, eq(activitiesTable.leadId, leadsTable.id))
      .leftJoin(usersTable, eq(activitiesTable.userId, usersTable.numId))
      .where(whereCond)
      .orderBy(desc(activitiesTable.createdAt))
      .limit(limit);
  }

  res.json(rows.map(r => ({
    ...r.activity,
    leadCompanyName: r.lead?.companyName ?? "Unknown",
    userName: r.user ? `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email?.split("@")[0] : null,
    userAvatar: r.user?.profileImageUrl ?? null,
    createdAt: r.activity.createdAt.toISOString(),
  })));
});

export default router;
