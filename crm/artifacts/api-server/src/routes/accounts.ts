import { Router, type IRouter, type Request, type Response } from "express";
import { db, accountsTable, usersTable, auditLogsTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

async function logAudit(userId: number | null, action: string, workspaceId: number | null, oldValue?: string, newValue?: string, ipAddress?: string) {
  await db.insert(auditLogsTable).values({
    leadId: null, userId, action, tableName: "accounts", fieldName: null,
    oldValue: oldValue ?? null, newValue: newValue ?? null, ipAddress: ipAddress ?? null, workspaceId,
  }).catch(() => {});
}

async function getAccountDto(id: number, wid: number | null) {
  const [row] = await db.select({ account: accountsTable, owner: usersTable })
    .from(accountsTable)
    .leftJoin(usersTable, eq(accountsTable.ownerId, usersTable.numId))
    .where(and(eq(accountsTable.id, id), wsFilter(accountsTable.workspaceId, wid)));
  if (!row) return null;
  return {
    ...row.account,
    ownerName: row.owner ? `${row.owner.firstName ?? ""} ${row.owner.lastName ?? ""}`.trim() || row.owner.email?.split("@")[0] || null : null,
    createdAt: row.account.createdAt.toISOString(),
    updatedAt: row.account.updatedAt.toISOString(),
  };
}

router.get("/accounts", requirePermission("contacts.view"), async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const search = req.query.search as string | undefined;
  const wid = req.user!.workspaceId ?? null;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);

  let rows = await db.select({ account: accountsTable, owner: usersTable })
    .from(accountsTable)
    .leftJoin(usersTable, eq(accountsTable.ownerId, usersTable.numId))
    .where(wsFilter(accountsTable.workspaceId, wid))
    .orderBy(desc(accountsTable.createdAt));

  if (allowedOwnerIds !== null) {
    if (allowedOwnerIds.length === 0) {
      rows = rows.filter(r => r.account.ownerId === req.user!.id);
    } else {
      rows = rows.filter(r => r.account.ownerId !== null && allowedOwnerIds.includes(r.account.ownerId));
    }
  }

  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(r => r.account.name.toLowerCase().includes(s) || (r.account.industry?.toLowerCase().includes(s) ?? false));
  }

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);
  const accounts = pageRows.map(r => ({
    ...r.account,
    ownerName: r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() || r.owner.email?.split("@")[0] || null : null,
    createdAt: r.account.createdAt.toISOString(),
    updatedAt: r.account.updatedAt.toISOString(),
  }));

  res.json({ accounts, total, page, limit });
});

router.post("/accounts", requirePermission("contacts.create"), async (req: Request, res: Response) => {
  const { name, industry, website, size, phone, location, notes, ownerId } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const wid = req.user!.workspaceId ?? null;

  let resolvedOwnerId: number | null;
  if (req.user!.role === "bd") {
    resolvedOwnerId = req.user!.id;
  } else if (req.user!.role === "admin" || !ownerId) {
    resolvedOwnerId = ownerId ?? null;
  } else {
    const scopeIds = await getAllowedOwnerIds(req.user! as ScopeUser);
    if (scopeIds !== null && !scopeIds.includes(ownerId)) {
      res.status(403).json({ error: "Cannot assign to a user outside your team scope" }); return;
    }
    resolvedOwnerId = ownerId;
  }

  const [account] = await db.insert(accountsTable).values({
    name: name.trim(),
    industry: industry || null,
    website: website || null,
    size: size || null,
    phone: phone || null,
    location: location || null,
    notes: notes || null,
    ownerId: resolvedOwnerId,
    createdById: req.user!.id,
    workspaceId: wid,
  }).returning();

  await logAudit(req.user!.id, "create", wid, undefined, JSON.stringify(account), req.ip ?? undefined);
  const dto = await getAccountDto(account.id, wid);
  res.status(201).json(dto);
});

// NOTE: /accounts/export must come before /accounts/:id to avoid route shadowing
router.get("/accounts/export", requirePermission("contacts.export"), async (req: Request, res: Response) => {
  const wid = req.user!.workspaceId ?? null;
  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);

  let rows = await db.select({ account: accountsTable, owner: usersTable })
    .from(accountsTable)
    .leftJoin(usersTable, eq(accountsTable.ownerId, usersTable.numId))
    .where(wsFilter(accountsTable.workspaceId, wid))
    .orderBy(desc(accountsTable.createdAt));

  if (allowedOwnerIds !== null) {
    if (allowedOwnerIds.length === 0) {
      rows = rows.filter(r => r.account.ownerId === req.user!.id);
    } else {
      rows = rows.filter(r => r.account.ownerId !== null && allowedOwnerIds.includes(r.account.ownerId));
    }
  }

  const headers = ["ID", "Name", "Industry", "Website", "Size", "Phone", "Location", "Owner", "Created"];
  const csvRows = rows.map(r => [
    r.account.id, r.account.name, r.account.industry ?? "", r.account.website ?? "",
    r.account.size ?? "", r.account.phone ?? "", r.account.location ?? "",
    r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() : "",
    r.account.createdAt.toISOString().split("T")[0],
  ]);
  const csv = [headers, ...csvRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=accounts-export.csv");
  res.send(csv);
});

router.get("/accounts/:id", requirePermission("contacts.view"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;

  const dto = await getAccountDto(id, wid);
  if (!dto) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? dto.ownerId === req.user!.id
      : dto.ownerId !== null && allowedOwnerIds.includes(dto.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  res.json(dto);
});

router.patch("/accounts/:id", requirePermission("contacts.edit"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;

  const [existing] = await db.select().from(accountsTable)
    .where(and(eq(accountsTable.id, id), wsFilter(accountsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? existing.ownerId === req.user!.id
      : existing.ownerId !== null && allowedOwnerIds.includes(existing.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const { name, industry, website, size, phone, location, notes, ownerId } = req.body;
  const updates: Partial<typeof accountsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (industry !== undefined) updates.industry = industry;
  if (website !== undefined) updates.website = website;
  if (size !== undefined) updates.size = size;
  if (phone !== undefined) updates.phone = phone;
  if (location !== undefined) updates.location = location;
  if (notes !== undefined) updates.notes = notes;
  if (ownerId !== undefined && req.user!.role !== "bd") {
    if (req.user!.role !== "admin" && ownerId !== null && allowedOwnerIds !== null && !allowedOwnerIds.includes(ownerId)) {
      res.status(403).json({ error: "Cannot assign to a user outside your team scope" }); return;
    }
    updates.ownerId = ownerId;
  }

  await db.update(accountsTable).set(updates).where(eq(accountsTable.id, id));
  await logAudit(req.user!.id, "update", wid, JSON.stringify(existing), JSON.stringify({ ...existing, ...updates }), req.ip ?? undefined);
  const dto = await getAccountDto(id, wid);
  res.json(dto);
});

router.delete("/accounts/:id", requirePermission("contacts.delete"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const wid = req.user!.workspaceId ?? null;

  const [existing] = await db.select().from(accountsTable)
    .where(and(eq(accountsTable.id, id), wsFilter(accountsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (req.user!.role === "manager") {
    const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
    if (allowedOwnerIds !== null && (existing.ownerId === null || !allowedOwnerIds.includes(existing.ownerId))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  await db.delete(accountsTable).where(eq(accountsTable.id, id));
  await logAudit(req.user!.id, "delete", wid, JSON.stringify(existing), undefined, req.ip ?? undefined);
  res.status(204).send();
});

router.post("/accounts/bulk-delete", requirePermission("contacts.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const ids: number[] = req.body.ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" }); return;
  }
  const wid = req.user!.workspaceId ?? null;
  await db.delete(accountsTable).where(
    and(inArray(accountsTable.id, ids), wsFilter(accountsTable.workspaceId, wid))
  );
  await logAudit(req.user!.id, "bulk_delete", wid, JSON.stringify({ ids }), undefined, req.ip ?? undefined);
  res.json({ deleted: ids.length });
});

export default router;
