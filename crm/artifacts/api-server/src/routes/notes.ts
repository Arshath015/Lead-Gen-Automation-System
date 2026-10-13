import { Router, type IRouter, type Request, type Response } from "express";
import { db, notesTable, usersTable, activitiesTable, contactsTable, dealsTable, leadsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";
import { requirePermission } from "../lib/permissions";
import {
  ListNotesParams,
  CreateNoteParams,
  CreateNoteBody,
  UpdateNoteParams,
  UpdateNoteBody,
  DeleteNoteParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const NoteBody = CreateNoteBody;

router.get("/leads/:leadId/notes", requirePermission("leads.view"), async (req: Request, res: Response) => {
  const params = ListNotesParams.safeParse({ leadId: Number(req.params.leadId) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db.select({ note: notesTable, user: usersTable })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.createdById, usersTable.numId))
    .where(eq(notesTable.leadId, params.data.leadId));

  res.json(rows.map(r => ({
    ...r.note,
    createdByName: r.user ? `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email?.split("@")[0] : null,
    createdByAvatar: r.user?.profileImageUrl ?? null,
    createdAt: r.note.createdAt.toISOString(),
    updatedAt: r.note.updatedAt.toISOString(),
  })));
});

router.post("/leads/:leadId/notes", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  const params = CreateNoteParams.safeParse({ leadId: Number(req.params.leadId) });
  const body = CreateNoteBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  const noteType: string = (body.data as any).type ?? "note";
  const [note] = await db.insert(notesTable).values({
    leadId: params.data.leadId,
    type: noteType,
    content: body.data.content,
    createdById: req.user!.id,
    workspaceId: wid,
  }).returning();

  const activityTypeMap: Record<string, string> = { email: "note_added", call: "note_added", note: "note_added" };
  const activityType = activityTypeMap[noteType] ?? "note_added";
  const activityDesc = noteType === "email" ? "Email logged" : noteType === "call" ? "Call logged" : "Note added";
  await db.insert(activitiesTable).values({
    leadId: params.data.leadId,
    type: activityType as any,
    description: activityDesc,
    userId: req.user!.id,
    workspaceId: wid,
  });

  res.status(201).json({
    ...note,
    createdByName: null,
    createdByAvatar: null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  });
});

// ─── Contact Notes ──────────────────────────────────────────────────────────

router.get("/contacts/:contactId/notes", requirePermission("contacts.view"), async (req: Request, res: Response) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isFinite(contactId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [contact] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), wsFilter(contactsTable.workspaceId, wid)));
  if (!contact) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? contact.ownerId === req.user!.id
      : contact.ownerId !== null && allowedOwnerIds.includes(contact.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const rows = await db.select({ note: notesTable, user: usersTable })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.createdById, usersTable.numId))
    .where(eq(notesTable.contactId, contactId));

  res.json(rows.map(r => ({
    ...r.note,
    createdByName: r.user ? `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email?.split("@")[0] : null,
    createdByAvatar: r.user?.profileImageUrl ?? null,
    createdAt: r.note.createdAt.toISOString(),
    updatedAt: r.note.updatedAt.toISOString(),
  })));
});

router.post("/contacts/:contactId/notes", requirePermission("contacts.edit"), async (req: Request, res: Response) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isFinite(contactId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = NoteBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [contact] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), wsFilter(contactsTable.workspaceId, wid)));
  if (!contact) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? contact.ownerId === req.user!.id
      : contact.ownerId !== null && allowedOwnerIds.includes(contact.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const noteType: string = (body.data as any).type ?? "note";
  const [note] = await db.insert(notesTable).values({
    contactId,
    type: noteType,
    content: body.data.content,
    createdById: req.user!.id,
    workspaceId: wid,
  }).returning();

  res.status(201).json({
    ...note,
    createdByName: null,
    createdByAvatar: null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  });
});

// ─── Deal Notes ─────────────────────────────────────────────────────────────

router.get("/deals/:dealId/notes", requirePermission("deals.view"), async (req: Request, res: Response) => {
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [deal] = await db.select().from(dealsTable)
    .where(and(eq(dealsTable.id, dealId), wsFilter(dealsTable.workspaceId, wid)));
  if (!deal) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? deal.ownerId === req.user!.id
      : deal.ownerId !== null && allowedOwnerIds.includes(deal.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const rows = await db.select({ note: notesTable, user: usersTable })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.createdById, usersTable.numId))
    .where(eq(notesTable.dealId, dealId));

  res.json(rows.map(r => ({
    ...r.note,
    createdByName: r.user ? `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email?.split("@")[0] : null,
    createdByAvatar: r.user?.profileImageUrl ?? null,
    createdAt: r.note.createdAt.toISOString(),
    updatedAt: r.note.updatedAt.toISOString(),
  })));
});

router.post("/deals/:dealId/notes", requirePermission("deals.edit"), async (req: Request, res: Response) => {
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = NoteBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [deal] = await db.select().from(dealsTable)
    .where(and(eq(dealsTable.id, dealId), wsFilter(dealsTable.workspaceId, wid)));
  if (!deal) { res.status(404).json({ error: "Not found" }); return; }

  const allowedOwnerIds = await getAllowedOwnerIds(req.user! as ScopeUser);
  if (allowedOwnerIds !== null) {
    const allowed = allowedOwnerIds.length === 0
      ? deal.ownerId === req.user!.id
      : deal.ownerId !== null && allowedOwnerIds.includes(deal.ownerId);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const noteType: string = (body.data as any).type ?? "note";
  const [note] = await db.insert(notesTable).values({
    dealId,
    type: noteType,
    content: body.data.content,
    createdById: req.user!.id,
    workspaceId: wid,
  }).returning();

  res.status(201).json({
    ...note,
    createdByName: null,
    createdByAvatar: null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  });
});

router.patch("/notes/:id", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  const params = UpdateNoteParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateNoteBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [existing] = await db.select().from(notesTable)
    .where(and(eq(notesTable.id, params.data.id), wsFilter(notesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [note] = await db.update(notesTable).set({ content: body.data.content })
    .where(eq(notesTable.id, params.data.id)).returning();

  res.json({
    ...note,
    createdByName: null,
    createdByAvatar: null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  });
});

router.delete("/notes/:id", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  const params = DeleteNoteParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user!.workspaceId ?? null;

  const [existing] = await db.select().from(notesTable)
    .where(and(eq(notesTable.id, params.data.id), wsFilter(notesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(notesTable).where(eq(notesTable.id, params.data.id));
  res.status(204).send();
});

export default router;
