import { Router, type IRouter, type Request, type Response } from "express";
import { db, followupsTable, leadsTable, usersTable, activitiesTable, notificationsTable } from "@workspace/db";
import { eq, and, lte, inArray, desc } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { nextReminderGeneration } from "../lib/reminder-delivery";
import {
  ListFollowupsParams,
  ListFollowupsQueryParams,
  CreateFollowupParams,
  CreateFollowupBody,
  UpdateFollowupParams,
  UpdateFollowupBody,
  DeleteFollowupParams,
} from "@workspace/api-zod";
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

router.get("/leads/:leadId/followups", requirePermission("followups.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListFollowupsParams.safeParse({ leadId: Number(req.params.leadId) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const qp = ListFollowupsQueryParams.safeParse(req.query);
  const status = qp.success ? qp.data.status : undefined;
  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessLead(req.user, lead))) { res.status(403).json({ error: "Forbidden" }); return; }

  let rows = await db.select({
    followup: followupsTable,
    createdByName: usersTable.firstName,
  })
    .from(followupsTable)
    .leftJoin(usersTable, eq(followupsTable.createdById, usersTable.numId))
    .where(eq(followupsTable.leadId, params.data.leadId));

  if (status) rows = rows.filter(r => r.followup.status === status);

  res.json(rows.map(r => ({
    ...r.followup,
    createdByName: r.createdByName ?? null,
    scheduledAt: r.followup.scheduledAt.toISOString(),
    createdAt: r.followup.createdAt.toISOString(),
    updatedAt: r.followup.updatedAt.toISOString(),
  })));
});

router.post("/leads/:leadId/followups", requirePermission("followups.create"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = CreateFollowupParams.safeParse({ leadId: Number(req.params.leadId) });
  const body = CreateFollowupBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessLead(req.user, lead))) { res.status(403).json({ error: "Forbidden" }); return; }

  const [followup] = await db.insert(followupsTable).values({
    leadId: params.data.leadId,
    scheduledAt: new Date(body.data.scheduledAt),
    notes: body.data.notes ?? null,
    createdById: req.user.id,
    workspaceId: wid,
  }).returning();

  // Keep the lead's original createdAt untouched. This field is only the
  // current scheduling/classification date used by week and date-range views.
  await db.update(leadsTable)
    .set({ nextFollowUpAt: followup.scheduledAt })
    .where(eq(leadsTable.id, params.data.leadId));

  await db.insert(activitiesTable).values({
    leadId: params.data.leadId,
    type: "followup_added",
    description: `Follow-up scheduled for ${new Date(body.data.scheduledAt).toLocaleDateString()}`,
    userId: req.user.id,
    workspaceId: wid,
  });

  res.status(201).json({
    ...followup,
    scheduledAt: followup.scheduledAt.toISOString(),
    createdAt: followup.createdAt.toISOString(),
    updatedAt: followup.updatedAt.toISOString(),
  });
});

router.patch("/followups/:id", requirePermission("followups.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateFollowupParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateFollowupBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [followup] = await db.select().from(followupsTable)
    .where(and(eq(followupsTable.id, params.data.id), wsFilter(followupsTable.workspaceId, wid)));
  if (!followup) { res.status(404).json({ error: "Not found" }); return; }

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, followup.leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead || !(await canAccessLead(req.user, lead))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const updateData: Partial<typeof followupsTable.$inferInsert> = {};
  if (body.data.scheduledAt !== undefined) updateData.scheduledAt = new Date(body.data.scheduledAt);
  if (body.data.notes !== undefined) updateData.notes = body.data.notes;
  if (body.data.status !== undefined) updateData.status = body.data.status;

  const [updated] = await db.transaction(async (tx) => {
    const [current] = await tx.select({
      scheduledAt: followupsTable.scheduledAt,
      reminderGeneration: followupsTable.reminderGeneration,
    }).from(followupsTable).where(eq(followupsTable.id, params.data.id)).for("update");
    if (!current) return [undefined];
    const nextGeneration = updateData.scheduledAt === undefined
      ? current.reminderGeneration
      : nextReminderGeneration(current.scheduledAt, updateData.scheduledAt, current.reminderGeneration);
    const scheduleChanged = nextGeneration !== current.reminderGeneration;
    if (scheduleChanged) updateData.reminderGeneration = nextGeneration;
    const [row] = await tx.update(followupsTable).set(updateData)
      .where(eq(followupsTable.id, params.data.id)).returning();
    // Serialize notification removal with the cron's FOR UPDATE claim.
    // A new-schedule notification must never be removed after this commits.
    if (row && scheduleChanged) {
      await tx.delete(notificationsTable).where(and(
        eq(notificationsTable.followupId, row.id),
        eq(notificationsTable.type, "followup_due"),
      ));
    }
    if (row && (body.data.status !== undefined || body.data.scheduledAt !== undefined)) {
      const [latestPending] = await tx.select({ scheduledAt: followupsTable.scheduledAt })
        .from(followupsTable)
        .where(and(
          eq(followupsTable.leadId, followup.leadId),
          eq(followupsTable.status, "pending"),
          wsFilter(followupsTable.workspaceId, wid),
        ))
        .orderBy(desc(followupsTable.updatedAt), desc(followupsTable.id))
        .limit(1);
      await tx.update(leadsTable)
        .set({ nextFollowUpAt: latestPending?.scheduledAt ?? null })
        .where(and(eq(leadsTable.id, followup.leadId), wsFilter(leadsTable.workspaceId, wid)));
    }
    return [row];
  });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(activitiesTable).values({
    leadId: followup.leadId,
    type: "followup_updated",
    description: `Follow-up updated (${updated.status})`,
    userId: req.user.id,
    workspaceId: wid,
  });

  // Send in-app notification when the scheduled time was changed
  if (body.data.scheduledAt !== undefined) {
    const IST = "Asia/Kolkata";
    const newTime = updated.scheduledAt.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST,
    });
    const newDate = updated.scheduledAt.toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric", timeZone: IST,
    });
    await db.insert(notificationsTable).values({
      userId: req.user.id,
      type: "followup_updated",
      title: "Follow-up schedule updated",
      body: `${lead.companyName ?? "Lead"} — rescheduled to ${newDate} at ${newTime}`,
      leadId: followup.leadId,
      followupId: updated.id,
      workspaceId: wid,
    });
  }

  res.json({
    ...updated,
    scheduledAt: updated.scheduledAt.toISOString(),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.delete("/followups/:id", requirePermission("followups.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = DeleteFollowupParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [followup] = await db.select().from(followupsTable)
    .where(and(eq(followupsTable.id, params.data.id), wsFilter(followupsTable.workspaceId, wid)));
  if (!followup) { res.status(404).json({ error: "Not found" }); return; }

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, followup.leadId), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead || !(await canAccessLead(req.user, lead))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(followupsTable).where(eq(followupsTable.id, params.data.id));

    const [latestPendingFollowup] = await tx
      .select({ scheduledAt: followupsTable.scheduledAt })
      .from(followupsTable)
      .where(and(
        eq(followupsTable.leadId, followup.leadId),
        eq(followupsTable.status, "pending"),
        wsFilter(followupsTable.workspaceId, wid),
      ))
      .orderBy(desc(followupsTable.updatedAt), desc(followupsTable.id))
      .limit(1);

    // Deleting the current follow-up must move classification back to the most
    // recently updated pending follow-up, or to the immutable createdAt fallback
    // when no pending follow-up remains.
    await tx
      .update(leadsTable)
      .set({ nextFollowUpAt: latestPendingFollowup?.scheduledAt ?? null })
      .where(and(
        eq(leadsTable.id, followup.leadId),
        wsFilter(leadsTable.workspaceId, wid),
      ));
  });

  res.status(204).send();
});

router.get("/followups/due", requirePermission("followups.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const now = new Date();
  const wid = req.user.workspaceId ?? null;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let rows;
  if (allowedOwnerIds === null) {
    rows = await db.select({ followup: followupsTable, lead: leadsTable })
      .from(followupsTable)
      .leftJoin(leadsTable, eq(followupsTable.leadId, leadsTable.id))
      .where(and(
        eq(followupsTable.status, "pending"),
        lte(followupsTable.scheduledAt, now),
        wsFilter(followupsTable.workspaceId, wid),
      ));
  } else {
    const ownersToCheck = allowedOwnerIds.length === 0 ? [req.user.id] : allowedOwnerIds;
    const scopedLeads = await db.select({ id: leadsTable.id })
      .from(leadsTable)
      .where(and(
        inArray(leadsTable.ownerId, ownersToCheck),
        wsFilter(leadsTable.workspaceId, wid),
      ));
    const scopedLeadIds = scopedLeads.map(l => l.id);
    if (scopedLeadIds.length === 0) { res.json([]); return; }
    rows = await db.select({ followup: followupsTable, lead: leadsTable })
      .from(followupsTable)
      .leftJoin(leadsTable, eq(followupsTable.leadId, leadsTable.id))
      .where(and(
        eq(followupsTable.status, "pending"),
        lte(followupsTable.scheduledAt, now),
        inArray(followupsTable.leadId, scopedLeadIds),
        wsFilter(followupsTable.workspaceId, wid),
      ));
  }

  res.json(rows.map(r => ({
    ...r.followup,
    leadCompanyName: r.lead?.companyName ?? "Unknown",
    leadContactPerson: r.lead?.contactPerson ?? "Unknown",
    scheduledAt: r.followup.scheduledAt.toISOString(),
    createdAt: r.followup.createdAt.toISOString(),
    updatedAt: r.followup.updatedAt.toISOString(),
  })));
});

export default router;
