import { Router, type IRouter, type Request, type Response } from "express";
import { db, scheduledActivitiesTable, leadsTable, usersTable, activitiesTable, auditLogsTable, notificationsTable } from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

const ActivityInputSchema = z.object({
  type: z.enum(["task", "call", "meeting", "followup"]),
  subject: z.string().min(1).max(255),
  leadId: z.number().int().optional().nullable(),
  ownerId: z.number().int().optional().nullable(),
  dueAt: z.string(),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  notes: z.string().optional().nullable(),
});

const ActivityUpdateSchema = ActivityInputSchema.partial().extend({
  status: z.enum(["open", "completed", "overdue", "cancelled"]).optional(),
});

async function toDto(row: typeof scheduledActivitiesTable.$inferSelect) {
  const [lead] = row.leadId
    ? await db.select({ companyName: leadsTable.companyName }).from(leadsTable).where(eq(leadsTable.id, row.leadId))
    : [null];
  const [owner] = row.ownerId
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(eq(usersTable.numId, row.ownerId))
    : [null];
  const [creator] = row.createdById
    ? await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(eq(usersTable.numId, row.createdById))
    : [null];

  const name = (u: { firstName: string | null, lastName: string | null, email: string | null } | null) =>
    u ? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email?.split("@")[0] || null) : null;

  return {
    ...row,
    leadCompanyName: lead?.companyName ?? null,
    ownerName: name(owner),
    createdByName: name(creator),
    dueAt: row.dueAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function getDateRange(view: string, date: string): { from: Date; to: Date } {
  const d = date ? new Date(date) : new Date();
  d.setHours(0, 0, 0, 0);

  if (view === "week") {
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 7);
    return { from: mon, to: sun };
  }

  if (view === "month") {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { from, to };
  }

  // day (default)
  const to = new Date(d);
  to.setDate(d.getDate() + 1);
  return { from: d, to };
}

async function validateOwnerScope(user: Request["user"], targetOwnerId: number): Promise<boolean> {
  const allowedOwnerIds = await getAllowedOwnerIds(user as ScopeUser);
  if (allowedOwnerIds === null) return true;
  return allowedOwnerIds.includes(targetOwnerId);
}

async function logAudit(
  leadId: number | null,
  userId: number,
  action: string,
  newValue?: string,
  oldValue?: string,
  ipAddress?: string,
  workspaceId?: number | null,
) {
  await db.insert(auditLogsTable).values({
    leadId: leadId ?? null,
    userId,
    action,
    tableName: "scheduled_activities",
    fieldName: null,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    ipAddress: ipAddress ?? null,
    workspaceId: workspaceId ?? null,
  }).catch(() => {});
}

router.get("/scheduled-activities", requirePermission("activities.view"), async (req: Request, res: Response) => {
  const view = (req.query.view as string) || "day";
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const typeFilter = req.query.type as string | undefined;
  const statusFilter = req.query.status as string | undefined;
  const ownerIdFilter = req.query.ownerId ? Number(req.query.ownerId) : undefined;
  const leadIdFilter = req.query.leadId ? Number(req.query.leadId) : undefined;
  const wid = req.user!.workspaceId ?? null;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);

  let rows = await db.select().from(scheduledActivitiesTable)
    .where(wsFilter(scheduledActivitiesTable.workspaceId, wid))
    .orderBy(scheduledActivitiesTable.dueAt);

  // Auto-mark overdue
  const now = new Date();
  const overdueIds = rows
    .filter(r => r.status === "open" && r.dueAt < now)
    .map(r => r.id);
  if (overdueIds.length > 0) {
    await db.update(scheduledActivitiesTable)
      .set({ status: "overdue" })
      .where(inArray(scheduledActivitiesTable.id, overdueIds));
    rows = rows.map(r => overdueIds.includes(r.id) ? { ...r, status: "overdue" as const } : r);
  }

  // Apply scope
  if (allowedOwnerIds !== null) {
    rows = rows.filter(r => r.ownerId !== null && allowedOwnerIds.includes(r.ownerId));
  }

  // Apply date range (skip for "all" view)
  if (view !== "all") {
    const { from, to } = getDateRange(view, date);
    rows = rows.filter(r => r.dueAt >= from && r.dueAt < to);
  }

  if (typeFilter) rows = rows.filter(r => r.type === typeFilter);
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter);
  if (ownerIdFilter) rows = rows.filter(r => r.ownerId === ownerIdFilter);
  if (leadIdFilter) rows = rows.filter(r => r.leadId === leadIdFilter);

  const dtos = await Promise.all(rows.map(toDto));
  res.json({ activities: dtos, total: dtos.length });
});

router.post("/scheduled-activities", requirePermission("activities.create"), async (req: Request, res: Response) => {
  const parsed = ActivityInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() }); return; }

  const targetOwnerId = parsed.data.ownerId ?? req.user!.id;
  const ownerAllowed = await validateOwnerScope(req.user!, targetOwnerId);
  if (!ownerAllowed) {
    res.status(403).json({ error: "Cannot assign activity to that user" });
    return;
  }

  const wid = req.user!.workspaceId ?? null;

  const [row] = await db.insert(scheduledActivitiesTable).values({
    type: parsed.data.type,
    subject: parsed.data.subject,
    leadId: parsed.data.leadId ?? null,
    ownerId: targetOwnerId,
    dueAt: new Date(parsed.data.dueAt),
    priority: parsed.data.priority,
    notes: parsed.data.notes ?? null,
    createdById: req.user!.id,
    workspaceId: wid,
  }).returning();

  if (row.leadId) {
    await db.insert(activitiesTable).values({
      leadId: row.leadId,
      type: "followup_added",
      description: `Scheduled ${row.type}: "${row.subject}"`,
      userId: req.user!.id,
      workspaceId: wid,
    }).catch(() => {});
  }

  await logAudit(
    row.leadId ?? null,
    req.user!.id,
    "created",
    `${row.type}: "${row.subject}" due ${row.dueAt.toISOString()}`,
    undefined,
    req.ip,
    wid,
  );

  const dto = await toDto(row);
  res.status(201).json(dto);
});

router.patch("/scheduled-activities/:id", requirePermission("activities.edit"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = ActivityUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [existing] = await db.select().from(scheduledActivitiesTable)
    .where(and(eq(scheduledActivitiesTable.id, id), wsFilter(scheduledActivitiesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const readAllowed = await validateOwnerScope(req.user!, existing.ownerId ?? req.user!.id);
  if (!readAllowed) { res.status(403).json({ error: "Forbidden" }); return; }

  if ("ownerId" in parsed.data && parsed.data.ownerId != null) {
    const newOwnerAllowed = await validateOwnerScope(req.user!, parsed.data.ownerId);
    if (!newOwnerAllowed) {
      res.status(403).json({ error: "Cannot reassign activity to that user" });
      return;
    }
  }

  const update: Partial<typeof scheduledActivitiesTable.$inferInsert> = {};
  if (parsed.data.type !== undefined) update.type = parsed.data.type;
  if (parsed.data.subject !== undefined) update.subject = parsed.data.subject;
  if ("leadId" in parsed.data) update.leadId = parsed.data.leadId ?? null;
  if ("ownerId" in parsed.data) update.ownerId = parsed.data.ownerId ?? null;
  if (parsed.data.dueAt !== undefined) update.dueAt = new Date(parsed.data.dueAt);
  if (parsed.data.priority !== undefined) update.priority = parsed.data.priority;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if ("notes" in parsed.data) update.notes = parsed.data.notes ?? null;

  const [row] = await db.update(scheduledActivitiesTable).set(update).where(eq(scheduledActivitiesTable.id, id)).returning();

  await logAudit(
    row.leadId ?? null,
    req.user!.id,
    "updated",
    `${row.type}: "${row.subject}"`,
    `${existing.type}: "${existing.subject}"`,
    req.ip,
    wid,
  );

  const dto = await toDto(row);
  res.json(dto);
});

router.patch("/scheduled-activities/:id/complete", requirePermission("activities.edit"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;

  const [existing] = await db.select().from(scheduledActivitiesTable)
    .where(and(eq(scheduledActivitiesTable.id, id), wsFilter(scheduledActivitiesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const allowed = await validateOwnerScope(req.user!, existing.ownerId ?? req.user!.id);
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  const [row] = await db.update(scheduledActivitiesTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(scheduledActivitiesTable.id, id))
    .returning();

  if (row.leadId) {
    await db.insert(activitiesTable).values({
      leadId: row.leadId,
      type: "updated",
      description: `Completed ${row.type}: "${row.subject}"`,
      userId: req.user!.id,
      workspaceId: wid,
    }).catch(() => {});
  }

  await logAudit(
    row.leadId ?? null,
    req.user!.id,
    "completed",
    `${row.type}: "${row.subject}"`,
    undefined,
    req.ip,
    wid,
  );

  const dto = await toDto(row);
  res.json(dto);
});

router.delete("/scheduled-activities/:id", requirePermission("activities.delete"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;

  const [existing] = await db.select().from(scheduledActivitiesTable)
    .where(and(eq(scheduledActivitiesTable.id, id), wsFilter(scheduledActivitiesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const allowed = await validateOwnerScope(req.user!, existing.ownerId ?? req.user!.id);
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  await logAudit(
    existing.leadId ?? null,
    req.user!.id,
    "deleted",
    undefined,
    `${existing.type}: "${existing.subject}"`,
    req.ip,
    wid,
  );

  await db.delete(scheduledActivitiesTable).where(eq(scheduledActivitiesTable.id, id));
  res.status(204).send();
});

export default router;
