import { Router, type IRouter, type Request, type Response } from "express";
import { db, contactsTable, accountsTable, usersTable, auditLogsTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";

const router: IRouter = Router();

async function logAudit(userId: number | null, action: string, workspaceId: number | null, oldValue?: string, newValue?: string, ipAddress?: string) {
  await db.insert(auditLogsTable).values({
    leadId: null, userId, action, tableName: "contacts", fieldName: null,
    oldValue: oldValue ?? null, newValue: newValue ?? null, ipAddress: ipAddress ?? null, workspaceId,
  }).catch(() => {});
}

async function getContactDto(id: number, wid: number | null) {
  const [row] = await db.select({ contact: contactsTable, account: accountsTable, owner: usersTable })
    .from(contactsTable)
    .leftJoin(accountsTable, eq(contactsTable.accountId, accountsTable.id))
    .leftJoin(usersTable, eq(contactsTable.ownerId, usersTable.numId))
    .where(and(eq(contactsTable.id, id), wsFilter(contactsTable.workspaceId, wid)));
  if (!row) return null;
  return {
    ...row.contact,
    accountName: row.account?.name ?? null,
    ownerName: row.owner ? `${row.owner.firstName ?? ""} ${row.owner.lastName ?? ""}`.trim() || row.owner.email?.split("@")[0] || null : null,
    createdAt: row.contact.createdAt.toISOString(),
    updatedAt: row.contact.updatedAt.toISOString(),
  };
}

router.get("/contacts", requirePermission("contacts.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const search = req.query.search as string | undefined;
  const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
  const wid = req.user.workspaceId ?? null;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let rows = await db.select({ contact: contactsTable, account: accountsTable, owner: usersTable })
    .from(contactsTable)
    .leftJoin(accountsTable, eq(contactsTable.accountId, accountsTable.id))
    .leftJoin(usersTable, eq(contactsTable.ownerId, usersTable.numId))
    .where(wsFilter(contactsTable.workspaceId, wid))
    .orderBy(desc(contactsTable.createdAt));

  if (allowedOwnerIds !== null) {
    if (allowedOwnerIds.length === 0) {
      rows = rows.filter(r => r.contact.ownerId === req.user.id);
    } else {
      rows = rows.filter(r => r.contact.ownerId !== null && allowedOwnerIds.includes(r.contact.ownerId));
    }
  }

  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(r =>
      r.contact.firstName.toLowerCase().includes(s) ||
      (r.contact.lastName?.toLowerCase().includes(s) ?? false) ||
      (r.contact.email?.toLowerCase().includes(s) ?? false)
    );
  }
  if (accountId) rows = rows.filter(r => r.contact.accountId === accountId);

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);
  const contacts = pageRows.map(r => ({
    ...r.contact,
    accountName: r.account?.name ?? null,
    ownerName: r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() || r.owner.email?.split("@")[0] || null : null,
    createdAt: r.contact.createdAt.toISOString(),
    updatedAt: r.contact.updatedAt.toISOString(),
  }));

  res.json({ contacts, total, page, limit });
});

router.post("/contacts", requirePermission("contacts.create"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { firstName, lastName, email, phone, title, accountId, ownerId, notes } = req.body;
  if (!firstName?.trim()) { res.status(400).json({ error: "First name is required" }); return; }
  const wid = req.user.workspaceId ?? null;

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

  const [contact] = await db.insert(contactsTable).values({
    firstName: firstName.trim(),
    lastName: lastName || null,
    email: email || null,
    phone: phone || null,
    title: title || null,
    accountId: accountId ?? null,
    ownerId: resolvedOwnerId,
    createdById: req.user.id,
    notes: notes || null,
    workspaceId: wid,
  }).returning();

  await logAudit(req.user.id, "create", wid, undefined, JSON.stringify(contact), req.ip ?? undefined);
  const dto = await getContactDto(contact.id, wid);
  res.status(201).json(dto);
});

// NOTE: /contacts/export must come before /contacts/:id to avoid route shadowing
router.get("/contacts/export", requirePermission("contacts.export"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let rows = await db.select({ contact: contactsTable, account: accountsTable, owner: usersTable })
    .from(contactsTable)
    .leftJoin(accountsTable, eq(contactsTable.accountId, accountsTable.id))
    .leftJoin(usersTable, eq(contactsTable.ownerId, usersTable.numId))
    .where(wsFilter(contactsTable.workspaceId, wid))
    .orderBy(desc(contactsTable.createdAt));

  if (allowedOwnerIds !== null) {
    if (allowedOwnerIds.length === 0) {
      rows = rows.filter(r => r.contact.ownerId === req.user.id);
    } else {
      rows = rows.filter(r => r.contact.ownerId !== null && allowedOwnerIds.includes(r.contact.ownerId));
    }
  }

  const headers = ["ID", "First Name", "Last Name", "Email", "Phone", "Title", "Account", "Owner", "Created"];
  const csvRows = rows.map(r => [
    r.contact.id, r.contact.firstName, r.contact.lastName ?? "", r.contact.email ?? "",
    r.contact.phone ?? "", r.contact.title ?? "", r.account?.name ?? "",
    r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() : "",
    r.contact.createdAt.toISOString().split("T")[0],
  ]);
  const csv = [headers, ...csvRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=contacts-export.csv");
  res.send(csv);
});

router.get("/contacts/:id", requirePermission("contacts.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const dto = await getContactDto(id, wid);
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

router.patch("/contacts/:id", requirePermission("contacts.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.id, id), wsFilter(contactsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? existing.ownerId === req.user.id
      : existing.ownerId !== null && allowedOwnerIds.includes(existing.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const { firstName, lastName, email, phone, title, accountId, ownerId, notes } = req.body;
  const updates: Partial<typeof contactsTable.$inferInsert> = {};
  if (firstName !== undefined) updates.firstName = firstName;
  if (lastName !== undefined) updates.lastName = lastName;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (title !== undefined) updates.title = title;
  if (accountId !== undefined) updates.accountId = accountId;
  if (ownerId !== undefined && req.user.role !== "bd") {
    if (req.user.role !== "admin" && ownerId !== null && allowedOwnerIds !== null && !allowedOwnerIds.includes(ownerId)) {
      res.status(403).json({ error: "Cannot assign to a user outside your team scope" }); return;
    }
    updates.ownerId = ownerId;
  }
  if (notes !== undefined) updates.notes = notes;

  await db.update(contactsTable).set(updates).where(eq(contactsTable.id, id));
  await logAudit(req.user.id, "update", wid, JSON.stringify(existing), JSON.stringify({ ...existing, ...updates }), req.ip ?? undefined);
  const dto = await getContactDto(id, wid);
  res.json(dto);
});

router.delete("/contacts/:id", requirePermission("contacts.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role === "bd") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.id, id), wsFilter(contactsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (req.user.role === "manager") {
    const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
    if (allowedOwnerIds !== null && (existing.ownerId === null || !allowedOwnerIds.includes(existing.ownerId))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  await db.delete(contactsTable).where(eq(contactsTable.id, id));
  await logAudit(req.user.id, "delete", wid, JSON.stringify(existing), undefined, req.ip ?? undefined);
  res.status(204).send();
});

router.post("/contacts/bulk-delete", requirePermission("contacts.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const ids: number[] = req.body.ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" }); return;
  }
  const wid = req.user!.workspaceId ?? null;
  await db.delete(contactsTable).where(
    and(inArray(contactsTable.id, ids), wsFilter(contactsTable.workspaceId, wid))
  );
  await logAudit(req.user!.id, "bulk_delete", wid, JSON.stringify({ ids }), undefined, req.ip ?? undefined);
  res.json({ deleted: ids.length });
});

export default router;
