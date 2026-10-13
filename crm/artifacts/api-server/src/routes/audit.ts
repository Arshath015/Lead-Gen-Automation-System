import { Router, type IRouter, type Request, type Response } from "express";
import { db, auditLogsTable, usersTable, leadsTable } from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

router.get("/audit", requirePermission("audit.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const qp = ListAuditLogsQueryParams.safeParse(req.query);
  const page = qp.data?.page ?? 1;
  const limit = qp.data?.limit ?? 50;
  const offset = (page - 1) * limit;
  const filterLeadId = qp.data?.leadId;
  const filterUserId = qp.data?.userId;
  const filterAction = qp.data?.action;
  const filterDateFrom = qp.data?.dateFrom;
  const filterDateTo = qp.data?.dateTo;

  const wid = req.user.workspaceId ?? null;

  let rows = await db.select({
    log: auditLogsTable,
    user: usersTable,
    lead: leadsTable,
  })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.numId))
    .leftJoin(leadsTable, eq(auditLogsTable.leadId, leadsTable.id))
    .where(wsFilter(auditLogsTable.workspaceId, wid))
    .orderBy(desc(auditLogsTable.createdAt));

  if (filterLeadId) rows = rows.filter(r => r.log.leadId === filterLeadId);
  if (filterUserId) rows = rows.filter(r => r.log.userId === filterUserId);
  if (filterAction) rows = rows.filter(r => r.log.action.includes(filterAction));
  if (filterDateFrom) rows = rows.filter(r => r.log.createdAt >= new Date(filterDateFrom));
  if (filterDateTo) rows = rows.filter(r => r.log.createdAt <= new Date(filterDateTo));

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);

  res.json({
    logs: pageRows.map(r => ({
      ...r.log,
      leadCompanyName: r.lead?.companyName ?? null,
      userName: r.user ? `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email?.split("@")[0] : null,
      createdAt: r.log.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
  });
});

export default router;
