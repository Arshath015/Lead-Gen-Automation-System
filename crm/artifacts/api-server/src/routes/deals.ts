import { Router, type IRouter, type Request, type Response } from "express";
import { db, dealsTable, stagesTable, accountsTable, contactsTable, usersTable, auditLogsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";

const router: IRouter = Router();

async function logAudit(userId: number | null, action: string, workspaceId: number | null, fieldName?: string, oldValue?: string, newValue?: string, ipAddress?: string) {
  await db.insert(auditLogsTable).values({
    leadId: null, userId, action, tableName: "deals", fieldName: fieldName ?? null,
    oldValue: oldValue ?? null, newValue: newValue ?? null, ipAddress: ipAddress ?? null, workspaceId,
  }).catch(() => {});
}

async function getDealDto(id: number, wid: number | null) {
  const [row] = await db.select({
    deal: dealsTable,
    stage: stagesTable,
    account: accountsTable,
    contact: contactsTable,
    owner: usersTable,
  })
    .from(dealsTable)
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .leftJoin(accountsTable, eq(dealsTable.accountId, accountsTable.id))
    .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
    .leftJoin(usersTable, eq(dealsTable.ownerId, usersTable.numId))
    .where(and(eq(dealsTable.id, id), wsFilter(dealsTable.workspaceId, wid)));
  if (!row) return null;
  return {
    ...row.deal,
    stageName: row.stage?.name ?? null,
    stageColor: row.stage?.color ?? null,
    accountName: row.account?.name ?? null,
    contactName: row.contact ? `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim() : null,
    ownerName: row.owner ? `${row.owner.firstName ?? ""} ${row.owner.lastName ?? ""}`.trim() || row.owner.email?.split("@")[0] || null : null,
    value: row.deal.value?.toString() ?? null,
    createdAt: row.deal.createdAt.toISOString(),
    updatedAt: row.deal.updatedAt.toISOString(),
    closeDate: row.deal.closeDate?.toISOString() ?? null,
  };
}

router.get("/deals", requirePermission("deals.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 100;
  const offset = (page - 1) * limit;
  const search = req.query.search as string | undefined;
  const stageIdFilter = req.query.stageId ? Number(req.query.stageId) : undefined;
  const ownerIdFilter = req.query.ownerId ? Number(req.query.ownerId) : undefined;
  const accountIdFilter = req.query.accountId ? Number(req.query.accountId) : undefined;
  const wid = req.user.workspaceId ?? null;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let rows = await db.select({ deal: dealsTable, stage: stagesTable, account: accountsTable, contact: contactsTable, owner: usersTable })
    .from(dealsTable)
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .leftJoin(accountsTable, eq(dealsTable.accountId, accountsTable.id))
    .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
    .leftJoin(usersTable, eq(dealsTable.ownerId, usersTable.numId))
    .where(wsFilter(dealsTable.workspaceId, wid))
    .orderBy(desc(dealsTable.createdAt));

  if (allowedOwnerIds !== null) {
    if (allowedOwnerIds.length === 0) {
      rows = rows.filter(r => r.deal.ownerId === req.user.id);
    } else {
      rows = rows.filter(r => r.deal.ownerId !== null && allowedOwnerIds.includes(r.deal.ownerId));
    }
  }

  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(r => r.deal.name.toLowerCase().includes(s) || (r.account?.name.toLowerCase().includes(s) ?? false));
  }
  if (stageIdFilter) rows = rows.filter(r => r.deal.stageId === stageIdFilter);
  if (ownerIdFilter) {
    if (allowedOwnerIds === null || allowedOwnerIds.includes(ownerIdFilter)) {
      rows = rows.filter(r => r.deal.ownerId === ownerIdFilter);
    }
  }
  if (accountIdFilter) rows = rows.filter(r => r.deal.accountId === accountIdFilter);

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);
  const deals = pageRows.map(r => ({
    ...r.deal,
    stageName: r.stage?.name ?? null,
    stageColor: r.stage?.color ?? null,
    accountName: r.account?.name ?? null,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName ?? ""}`.trim() : null,
    ownerName: r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() || r.owner.email?.split("@")[0] || null : null,
    value: r.deal.value?.toString() ?? null,
    createdAt: r.deal.createdAt.toISOString(),
    updatedAt: r.deal.updatedAt.toISOString(),
    closeDate: r.deal.closeDate?.toISOString() ?? null,
  }));

  res.json({ deals, total, page, limit });
});

router.post("/deals", requirePermission("deals.create"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { name, value, currency, stageId, closeDate, probability, accountId, contactId, ownerId, notes, convertedFromLeadId } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const wid = req.user.workspaceId ?? null;

  let resolvedStageId = stageId;
  if (!resolvedStageId) {
    // Mirror of the lead-creation bug (see leads.ts) — must be scoped to
    // type="deal" or an unfiltered "first by order" query can tie-break
    // onto a lead stage (e.g. "New Lead") instead of "Ongoing".
    const [firstStage] = await db.select().from(stagesTable)
      .where(and(wsFilter(stagesTable.workspaceId, wid), eq(stagesTable.type, "deal")))
      .orderBy(stagesTable.order);
    resolvedStageId = firstStage?.id;
  }

  let resolvedOwnerId: number | null;
  if (req.user.role === "bd") {
    resolvedOwnerId = req.user.id;
  } else if (req.user.role === "admin" || !ownerId) {
    resolvedOwnerId = ownerId ?? null;
  } else {
    const scopeIds = await getAllowedOwnerIds(req.user as ScopeUser);
    if (scopeIds !== null && !scopeIds.includes(ownerId)) {
      res.status(403).json({ error: "Cannot assign to a user outside your team scope" }); return;
    }
    resolvedOwnerId = ownerId;
  }

  const [deal] = await db.insert(dealsTable).values({
    name: name.trim(),
    value: value ?? null,
    currency: currency ?? "USD",
    stageId: resolvedStageId ?? null,
    closeDate: closeDate ? new Date(closeDate) : null,
    probability: probability ?? 0,
    accountId: accountId ?? null,
    contactId: contactId ?? null,
    ownerId: resolvedOwnerId,
    createdById: req.user.id,
    notes: notes ?? null,
    convertedFromLeadId: convertedFromLeadId ?? null,
    workspaceId: wid,
  }).returning();

  await logAudit(req.user.id, "create", wid, undefined, undefined, JSON.stringify(deal), req.ip ?? undefined);
  const dto = await getDealDto(deal.id, wid);
  res.status(201).json(dto);
});

// NOTE: /deals/export must come before /deals/:id to avoid route shadowing
router.get("/deals/export", requirePermission("deals.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let rows = await db.select({ deal: dealsTable, stage: stagesTable, account: accountsTable, owner: usersTable })
    .from(dealsTable)
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .leftJoin(accountsTable, eq(dealsTable.accountId, accountsTable.id))
    .leftJoin(usersTable, eq(dealsTable.ownerId, usersTable.numId))
    .where(wsFilter(dealsTable.workspaceId, wid))
    .orderBy(desc(dealsTable.createdAt));

  if (allowedOwnerIds !== null) {
    if (allowedOwnerIds.length === 0) {
      rows = rows.filter(r => r.deal.ownerId === req.user.id);
    } else {
      rows = rows.filter(r => r.deal.ownerId !== null && allowedOwnerIds.includes(r.deal.ownerId));
    }
  }

  const headers = ["ID", "Name", "Value", "Currency", "Stage", "Account", "Owner", "Close Date", "Probability %", "Created"];
  const csvRows = rows.map(r => [
    r.deal.id, r.deal.name, r.deal.value?.toString() ?? "", r.deal.currency,
    r.stage?.name ?? "", r.account?.name ?? "",
    r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() : "",
    r.deal.closeDate?.toISOString().split("T")[0] ?? "",
    r.deal.probability ?? "",
    r.deal.createdAt.toISOString().split("T")[0],
  ]);
  const csv = [headers, ...csvRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=deals-export.csv");
  res.send(csv);
});

router.get("/deals/:id", requirePermission("deals.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const dto = await getDealDto(id, wid);
  if (!dto) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? dto.ownerId === req.user.id
      : dto.ownerId !== null && allowedOwnerIds.includes(dto.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  res.json(dto);
});

router.patch("/deals/:id", requirePermission("deals.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(dealsTable)
    .where(and(eq(dealsTable.id, id), wsFilter(dealsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? existing.ownerId === req.user.id
      : existing.ownerId !== null && allowedOwnerIds.includes(existing.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const { name, value, currency, stageId, closeDate, probability, accountId, contactId, ownerId, notes } = req.body;
  const updates: Partial<typeof dealsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (value !== undefined) updates.value = value !== null && value !== undefined ? String(value) : null;
  if (currency !== undefined) updates.currency = currency;
  if (stageId !== undefined) updates.stageId = stageId;
  if (closeDate !== undefined) updates.closeDate = closeDate ? new Date(closeDate) : null;
  if (probability !== undefined) updates.probability = probability;
  if (accountId !== undefined) updates.accountId = accountId;
  if (contactId !== undefined) updates.contactId = contactId;
  if (ownerId !== undefined && req.user.role !== "bd") {
    if (req.user.role !== "admin" && ownerId !== null && allowedOwnerIds !== null && !allowedOwnerIds.includes(ownerId)) {
      res.status(403).json({ error: "Cannot assign to a user outside your team scope" }); return;
    }
    updates.ownerId = ownerId;
  }
  if (notes !== undefined) updates.notes = notes;

  await db.update(dealsTable).set(updates).where(eq(dealsTable.id, id));
  await logAudit(req.user.id, "update", wid, undefined, JSON.stringify(existing), JSON.stringify({ ...existing, ...updates }), req.ip ?? undefined);
  const dto = await getDealDto(id, wid);
  res.json(dto);
});

router.patch("/deals/:id/stage", requirePermission("pipeline.move_stage"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const rawStageId = req.body.stageId;
  const resolvedStageId: number | null = (rawStageId === null || rawStageId === undefined || rawStageId === -1) ? null : Number(rawStageId);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(dealsTable)
    .where(and(eq(dealsTable.id, id), wsFilter(dealsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? existing.ownerId === req.user.id
      : existing.ownerId !== null && allowedOwnerIds.includes(existing.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const [oldStage] = existing.stageId ? await db.select().from(stagesTable).where(eq(stagesTable.id, existing.stageId)) : [null];
  const [newStage] = resolvedStageId ? await db.select().from(stagesTable).where(eq(stagesTable.id, resolvedStageId)) : [null];

  await db.update(dealsTable).set({ stageId: resolvedStageId }).where(eq(dealsTable.id, id));
  await logAudit(req.user.id, "stage_change", wid, "stage_id", oldStage?.name ?? undefined, newStage?.name ?? undefined, req.ip ?? undefined);

  const dto = await getDealDto(id, wid);
  res.json(dto);
});

router.delete("/deals/:id", requirePermission("deals.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  // BD cannot delete at all
  if (req.user.role === "bd") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(dealsTable)
    .where(and(eq(dealsTable.id, id), wsFilter(dealsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  // Non-admin: can only delete records they personally created
  if (req.user.role !== "admin") {
    if (existing.createdById !== req.user.id) {
      res.status(403).json({ error: "You can only delete deals you created" }); return;
    }
  }

  await db.delete(dealsTable).where(eq(dealsTable.id, id));
  await logAudit(req.user.id, "delete", wid, undefined, JSON.stringify(existing), undefined, req.ip ?? undefined);
  res.status(204).send();
});

export default router;
