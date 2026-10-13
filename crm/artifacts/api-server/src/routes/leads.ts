import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, stagesTable, usersTable, activitiesTable, auditLogsTable, notesTable, followupsTable, tagsTable, leadTagsTable, notificationsTable, teamMembersTable, contactsTable, accountsTable, dealsTable, dealRevenueEntriesTable } from "@workspace/db";
import { getCityVariants } from "./reports";
import { eq, and, ilike, or, gte, lt, lte, sql, inArray, desc, isNull } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { evaluateAutomationRules } from "./automation";
import {
  ListLeadsQueryParams,
  CreateLeadBody,
  GetLeadParams,
  UpdateLeadParams,
  UpdateLeadBody,
  DeleteLeadParams,
  AssignLeadParams,
  AssignLeadBody,
  UpdateLeadStageParams,
  UpdateLeadStageBody,
  BulkLeadActionBody,
  ImportLeadsBody,
} from "@workspace/api-zod";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";
import { shouldNotify } from "../lib/shouldNotify";
import { getLeadClassificationDate } from "../lib/lead-classification";
import { parseLeadRangeEndExclusive, parseLeadRangeStart } from "../lib/lead-date-range";
import { filterLeadsByIndustry } from "../lib/lead-industry-filter";
import { getLatestLostAt, getLostStage, isStageTransition, lostActivityMarker } from "../lib/lost-lead";
import {
  sendNewLeadNotification,
  sendSubordinateLeadNotification,
  sendStageChangeNotification,
  sendLeadAssignedNotification,
  sendBulkLeadAssignedNotification,
} from "../lib/email";

const router: IRouter = Router();

async function getTagsForLead(leadId: number) {
  const rows = await db.select({ tag: tagsTable }).from(leadTagsTable)
    .innerJoin(tagsTable, eq(leadTagsTable.tagId, tagsTable.id))
    .where(eq(leadTagsTable.leadId, leadId));
  return rows.map(r => r.tag);
}

async function setTagsForLead(leadId: number, tagIds: number[]) {
  await db.delete(leadTagsTable).where(eq(leadTagsTable.leadId, leadId));
  if (tagIds.length > 0) {
    await db.insert(leadTagsTable).values(tagIds.map(tagId => ({ leadId, tagId })));
  }
}

async function getLeadWithDetails(id: number) {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) return null;
  const [stage] = lead.stageId ? await db.select().from(stagesTable).where(eq(stagesTable.id, lead.stageId)) : [null];
  const [owner] = lead.ownerId ? await db.select().from(usersTable).where(eq(usersTable.numId, lead.ownerId)) : [null];
  const tags = await getTagsForLead(id);
  return {
    ...lead,
    stageName: stage?.name ?? null,
    stageColor: stage?.color ?? null,
    ownerName: owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || (owner.email?.split("@")[0] ?? null) : null,
    tags,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    expectedCloseDate: lead.expectedCloseDate?.toISOString() ?? null,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    lostAt: await getLatestLostAt(id, lead.workspaceId),
  };
}

async function logActivity(leadId: number, type: string, description: string, userId: number | null, oldValue?: string, newValue?: string, workspaceId?: number | null) {
  await db.insert(activitiesTable).values({
    leadId, type: type as any, description, userId, oldValue: oldValue ?? null, newValue: newValue ?? null, workspaceId: workspaceId ?? null
  });
}

async function logAudit(leadId: number | null, userId: number | null, action: string, fieldName?: string, oldValue?: string, newValue?: string, ipAddress?: string, workspaceId?: number | null) {
  await db.insert(auditLogsTable).values({
    leadId, userId, action, tableName: "leads", fieldName: fieldName ?? null, oldValue: oldValue ?? null, newValue: newValue ?? null, ipAddress: ipAddress ?? null, workspaceId: workspaceId ?? null
  });
}

/**
 * Returns true if the current user is allowed to access the given lead.
 * Creators always retain access to leads they created, regardless of assignment.
 */
async function canAccessLead(user: Express.User, lead: typeof leadsTable.$inferSelect): Promise<boolean> {
  if (user.role === "admin") return true;
  // Creator always retains access (e.g. admin creates lead, assigns to BD, still sees it)
  if (lead.createdById === user.id) return true;
  if (user.role === "manager") {
    const allowedIds = await getAllowedOwnerIds(user as ScopeUser);
    if (allowedIds === null) return true;
    // Unassigned leads (ownerId === null) are visible/assignable by all managers
    if (lead.ownerId === null) return true;
    // Lead created by a team member is always visible to manager
    if (lead.createdById !== null && allowedIds.includes(lead.createdById)) return true;
    return allowedIds.includes(lead.ownerId);
  }
  // BD: only own leads
  return lead.ownerId === user.id;
}

router.get("/leads", requirePermission("leads.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const qp = ListLeadsQueryParams.safeParse(req.query);
  const page = qp.data?.page ?? 1;
  const limit = qp.data?.limit ?? 20;
  const offset = (page - 1) * limit;
  const stageId = qp.data?.stageId;
  const ownerId = qp.data?.ownerId;
  const industry = qp.data?.industry;
  const location = qp.data?.location;
  const source = qp.data?.source;
  const priority = (req.query.priority as string) || undefined;
  const channel = (req.query.channel as string) || undefined;
  const tagId = req.query.tagId ? Number(req.query.tagId) : undefined;
  const search = qp.data?.search;
  const dateFrom = qp.data?.dateFrom;
  const dateTo = qp.data?.dateTo;
  const status = (req.query.status as string) || undefined;
  const missing = (req.query.missing as string) || undefined;
  const stale = req.query.stale === "true";
  const followupDue = (req.query.followupDue as string) || undefined;

  const wid = req.user.workspaceId ?? null;

  let rows = await db.select({
    lead: leadsTable,
    stageName: stagesTable.name,
    stageColor: stagesTable.color,
    stageIsWon: stagesTable.isWon,
    stageIsLost: stagesTable.isLost,
  })
    .from(leadsTable)
    .leftJoin(stagesTable, eq(leadsTable.stageId, stagesTable.id))
    .where(wsFilter(leadsTable.workspaceId, wid));

  // ── Scope enforcement (server-side) ─────────────────────────────────────────
  const unassigned = req.query.unassigned === "true";
  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  if (unassigned && req.user.role !== "bd") {
    // Admin/Manager requesting unassigned leads: these have no owner, so
    // ownerId-based scope doesn't apply. Filter for null ownerId directly.
    // BD users fall through to the normal scope branch (yielding own leads only,
    // none of which are unassigned).
    rows = rows.filter(r => r.lead.ownerId === null);
  } else if (allowedOwnerIds !== null) {
    // Non-admin scope: show leads the user owns, created, OR that were created/owned
    // by any of their allowed subordinates (fixes manager visibility for self-created leads)
    rows = rows.filter(r =>
      r.lead.createdById === req.user.id ||
      (r.lead.ownerId !== null && allowedOwnerIds.includes(r.lead.ownerId)) ||
      (r.lead.createdById !== null && allowedOwnerIds.includes(r.lead.createdById))
    );
  }

  // ── Regular filters ──────────────────────────────────────────────────────────
  if (stageId) rows = rows.filter(r => r.lead.stageId === stageId);
  if (ownerId) rows = rows.filter(r => r.lead.ownerId === ownerId);
  rows = filterLeadsByIndustry(rows, industry);
  if (location) {
    // Expand to all synonym variants so "Bangalore" also matches raw "Bengaluru"
    // entries — list count stays in sync with the chart.
    const locVariants = getCityVariants(location);
    rows = rows.filter(r => {
      const raw = r.lead.location?.toLowerCase() ?? "";
      return locVariants.some(v => raw.includes(v));
    });
  }
  if (source) rows = rows.filter(r => r.lead.source === source);
  if (priority) rows = rows.filter(r => r.lead.priority === priority);
  if (channel) rows = rows.filter(r => r.lead.channel === channel);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(r =>
      r.lead.companyName.toLowerCase().includes(s) ||
      r.lead.contactPerson.toLowerCase().includes(s) ||
      (r.lead.email?.toLowerCase().includes(s) ?? false)
    );
  }
  // A scheduled follow-up moves a lead into that date/week bucket. Leads
  // without one retain the original createdAt behavior.
  const rangeStart = parseLeadRangeStart(dateFrom);
  const rangeEndExclusive = parseLeadRangeEndExclusive(dateTo);
  if (rangeStart) rows = rows.filter(r => getLeadClassificationDate(r.lead) >= rangeStart);
  if (rangeEndExclusive) rows = rows.filter(r => getLeadClassificationDate(r.lead) < rangeEndExclusive);
  if (status === "won") rows = rows.filter(r => r.stageIsWon === true);
  if (status === "lost") rows = rows.filter(r => r.stageIsLost === true);
  if (status === "active") rows = rows.filter(r => !r.stageIsWon && !r.stageIsLost);
  if (missing === "email") rows = rows.filter(r => !r.lead.email);
  if (missing === "dealValue") rows = rows.filter(r => r.lead.valueAmount === null || r.lead.valueAmount === undefined);
  if (stale) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    rows = rows.filter(r => r.lead.updatedAt < cutoff);
  }

  // Follow-up due bucket filter — matches the date boundaries used by /dashboard/follow-ups-due
  if (followupDue) {
    const now = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const weekEnd  = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
    const leadIds  = rows.map(r => r.lead.id);
    if (leadIds.length > 0) {
      const pending = await db
        .select({ leadId: followupsTable.leadId, scheduledAt: followupsTable.scheduledAt })
        .from(followupsTable)
        .where(and(
          eq(followupsTable.status, "pending"),
          inArray(followupsTable.leadId, leadIds),
          lte(followupsTable.scheduledAt, weekEnd),
        ));
      const matchIds = new Set(
        pending
          .filter(f => {
            if (followupDue === "overdue") return f.scheduledAt < now;
            if (followupDue === "today")   return f.scheduledAt >= now && f.scheduledAt <= todayEnd;
            if (followupDue === "week")    return f.scheduledAt >  todayEnd && f.scheduledAt <= weekEnd;
            return false;
          })
          .map(f => f.leadId)
      );
      rows = rows.filter(r => matchIds.has(r.lead.id));
    } else {
      rows = [];
    }
  }

  // Tag filter
  if (tagId) {
    const taggedLeadIds = await db.select({ leadId: leadTagsTable.leadId })
      .from(leadTagsTable)
      .where(eq(leadTagsTable.tagId, tagId));
    const ids = taggedLeadIds.map(r => r.leadId);
    rows = rows.filter(r => ids.includes(r.lead.id));
  }

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);

  // Fetch tags for all page leads in one batch
  const allLeadIds = pageRows.map(r => r.lead.id);
  const tagRows = allLeadIds.length > 0
    ? await db.select({ leadId: leadTagsTable.leadId, tag: tagsTable })
        .from(leadTagsTable)
        .innerJoin(tagsTable, eq(leadTagsTable.tagId, tagsTable.id))
        .where(inArray(leadTagsTable.leadId, allLeadIds))
    : [];

  const tagsByLead = new Map<number, typeof tagsTable.$inferSelect[]>();
  for (const row of tagRows) {
    const existing = tagsByLead.get(row.leadId) ?? [];
    existing.push(row.tag);
    tagsByLead.set(row.leadId, existing);
  }

  const leads = pageRows.map(r => ({
    ...r.lead,
    stageName: r.stageName,
    stageColor: r.stageColor,
    ownerName: null,
    tags: tagsByLead.get(r.lead.id) ?? [],
    createdAt: r.lead.createdAt.toISOString(),
    updatedAt: r.lead.updatedAt.toISOString(),
    expectedCloseDate: r.lead.expectedCloseDate?.toISOString() ?? null,
    nextFollowUpAt: r.lead.nextFollowUpAt?.toISOString() ?? null,
  }));

  res.json({ leads, total, page, limit });
});

// ── Export endpoint — full unpaginated set, same filters as list ─────────────
router.get("/leads/export", requirePermission("leads.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const qp = ListLeadsQueryParams.safeParse(req.query);
  const stageId = qp.data?.stageId;
  const ownerId = qp.data?.ownerId;
  const industry = qp.data?.industry;
  const location = qp.data?.location;
  const source = qp.data?.source;
  const priority = (req.query.priority as string) || undefined;
  const channel = (req.query.channel as string) || undefined;
  const tagId = req.query.tagId ? Number(req.query.tagId) : undefined;
  const search = qp.data?.search;
  const dateFrom = qp.data?.dateFrom;
  const dateTo = qp.data?.dateTo;
  const status = (req.query.status as string) || undefined;
  const missing = (req.query.missing as string) || undefined;
  const stale = req.query.stale === "true";
  const followupDueExport = (req.query.followupDue as string) || undefined;
  const wid = req.user.workspaceId ?? null;

  let rows = await db.select({
    lead: leadsTable,
    stageName: stagesTable.name,
    stageIsWon: stagesTable.isWon,
    stageIsLost: stagesTable.isLost,
  })
    .from(leadsTable)
    .leftJoin(stagesTable, eq(leadsTable.stageId, stagesTable.id))
    .where(wsFilter(leadsTable.workspaceId, wid));

  // Scope enforcement (mirrors GET /leads)
  const unassigned = req.query.unassigned === "true";
  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  if (unassigned && req.user.role !== "bd") {
    rows = rows.filter(r => r.lead.ownerId === null);
  } else if (allowedOwnerIds !== null) {
    rows = rows.filter(r =>
      r.lead.createdById === req.user.id ||
      (r.lead.ownerId !== null && allowedOwnerIds.includes(r.lead.ownerId)) ||
      (r.lead.createdById !== null && allowedOwnerIds.includes(r.lead.createdById))
    );
  }

  // Apply all filters (same logic as GET /leads, no pagination)
  if (stageId) rows = rows.filter(r => r.lead.stageId === stageId);
  if (ownerId) rows = rows.filter(r => r.lead.ownerId === ownerId);
  rows = filterLeadsByIndustry(rows, industry);
  if (location) {
    const locVariants = getCityVariants(location);
    rows = rows.filter(r => {
      const raw = r.lead.location?.toLowerCase() ?? "";
      return locVariants.some(v => raw.includes(v));
    });
  }
  if (source) rows = rows.filter(r => r.lead.source === source);
  if (priority) rows = rows.filter(r => r.lead.priority === priority);
  if (channel) rows = rows.filter(r => r.lead.channel === channel);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(r =>
      r.lead.companyName.toLowerCase().includes(s) ||
      r.lead.contactPerson.toLowerCase().includes(s) ||
      (r.lead.email?.toLowerCase().includes(s) ?? false)
    );
  }
  const rangeStart = parseLeadRangeStart(dateFrom);
  const rangeEndExclusive = parseLeadRangeEndExclusive(dateTo);
  if (rangeStart) rows = rows.filter(r => getLeadClassificationDate(r.lead) >= rangeStart);
  if (rangeEndExclusive) rows = rows.filter(r => getLeadClassificationDate(r.lead) < rangeEndExclusive);
  if (status === "won") rows = rows.filter(r => r.stageIsWon === true);
  if (status === "lost") rows = rows.filter(r => r.stageIsLost === true);
  if (status === "active") rows = rows.filter(r => !r.stageIsWon && !r.stageIsLost);
  if (missing === "email") rows = rows.filter(r => !r.lead.email);
  if (missing === "dealValue") rows = rows.filter(r => r.lead.valueAmount === null || r.lead.valueAmount === undefined);
  if (stale) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    rows = rows.filter(r => r.lead.updatedAt < cutoff);
  }
  if (followupDueExport) {
    const now = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const weekEnd  = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
    const leadIds  = rows.map(r => r.lead.id);
    if (leadIds.length > 0) {
      const pending = await db
        .select({ leadId: followupsTable.leadId, scheduledAt: followupsTable.scheduledAt })
        .from(followupsTable)
        .where(and(
          eq(followupsTable.status, "pending"),
          inArray(followupsTable.leadId, leadIds),
          lte(followupsTable.scheduledAt, weekEnd),
        ));
      const matchIds = new Set(
        pending
          .filter(f => {
            if (followupDueExport === "overdue") return f.scheduledAt < now;
            if (followupDueExport === "today")   return f.scheduledAt >= now && f.scheduledAt <= todayEnd;
            if (followupDueExport === "week")    return f.scheduledAt >  todayEnd && f.scheduledAt <= weekEnd;
            return false;
          })
          .map(f => f.leadId)
      );
      rows = rows.filter(r => matchIds.has(r.lead.id));
    } else {
      rows = [];
    }
  }
  if (tagId) {
    const taggedLeadIds = await db.select({ leadId: leadTagsTable.leadId })
      .from(leadTagsTable)
      .where(eq(leadTagsTable.tagId, tagId));
    const taggedIds = taggedLeadIds.map(r => r.leadId);
    rows = rows.filter(r => taggedIds.includes(r.lead.id));
  }

  // Batch-resolve owner names
  const uniqueOwnerIds = [...new Set(rows.map(r => r.lead.ownerId).filter((id): id is number => id !== null))];
  const ownerMap = new Map<number, string>();
  if (uniqueOwnerIds.length > 0) {
    const owners = await db.select({ numId: usersTable.numId, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.numId, uniqueOwnerIds));
    for (const o of owners) {
      const name = (`${o.firstName ?? ""} ${o.lastName ?? ""}`).trim() || (o.email?.split("@")[0] ?? "");
      ownerMap.set(o.numId, name);
    }
  }

  const leads = rows.map(r => ({
    ...r.lead,
    stageName: r.stageName ?? null,
    ownerName: r.lead.ownerId ? (ownerMap.get(r.lead.ownerId) ?? null) : null,
    createdAt: r.lead.createdAt.toISOString(),
    updatedAt: r.lead.updatedAt.toISOString(),
    expectedCloseDate: r.lead.expectedCloseDate?.toISOString() ?? null,
    nextFollowUpAt: r.lead.nextFollowUpAt?.toISOString() ?? null,
  }));

  res.json({ leads, total: leads.length });
});

router.post("/leads", requirePermission("leads.create"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  let stageId = parsed.data.stageId;
  if (!stageId) {
    // BUGFIX: must be scoped to type="lead" — stages.order restarts at 1 for
    // both lead and deal stages, so an unfiltered "first by order" query can
    // tie-break onto a deal stage (e.g. "Ongoing") instead of "New Lead".
    // That silently misfiled every lead created without an explicit stageId
    // — including ones pushed in from the separate lead-gen app — into the
    // deals pipeline, where the Leads list's stage filters never find them.
    const [firstStage] = await db.select().from(stagesTable)
      .where(eq(stagesTable.type, "lead"))
      .orderBy(stagesTable.order);
    stageId = firstStage?.id;
  }

  const { tagIds, ...leadData } = parsed.data as any;

  // All users auto-own leads they create unless an explicit owner is set
  let ownerId = leadData.ownerId;
  if (!ownerId) {
    ownerId = req.user.id;
  }

  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.insert(leadsTable).values({
    ...leadData,
    stageId,
    ownerId: ownerId ?? null,
    createdById: req.user.id,
    source: (leadData.source as any) ?? "manual",
    workspaceId: wid,
  }).returning();

  if (tagIds?.length) {
    await setTagsForLead(lead.id, tagIds);
  }

  await logActivity(lead.id, "created", `Lead created for ${lead.companyName}`, req.user.id, undefined, undefined, wid);
  await logAudit(lead.id, req.user.id, "create", undefined, undefined, lead.companyName, req.ip ?? undefined, wid);
  await evaluateAutomationRules("new_lead", null, lead.id, req.user.id, wid).catch(() => {});

  // Email notifications (fire-and-forget)
  Promise.resolve().then(async () => {
    try {
      const [stage] = stageId ? await db.select().from(stagesTable).where(eq(stagesTable.id, stageId)) : [null];
      const stageName = stage?.name ?? "Unknown";

      // Notify the owner if they're a different user and opted in
      if (lead.ownerId && lead.ownerId !== req.user.id) {
        const [owner] = await db.select().from(usersTable).where(eq(usersTable.numId, lead.ownerId));
        if (owner?.email && await shouldNotify(lead.ownerId, "notifyNewLead")) {
          const ownerName = (`${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim()) || owner.email;
          sendNewLeadNotification(owner.email, ownerName, lead.companyName, stageName).catch(() => {});
        }
      }

      // Notify the creator's manager if they've opted into subordinate lead alerts
      const [creator] = await db.select().from(usersTable).where(eq(usersTable.numId, req.user.id));
      if (creator?.managerId) {
        const [manager] = await db.select().from(usersTable).where(eq(usersTable.numId, creator.managerId));
        if (manager?.email && await shouldNotify(creator.managerId, "notifyOnSubordinateManualLead")) {
          const creatorName = (`${creator.firstName ?? ""} ${creator.lastName ?? ""}`.trim()) || (creator.email ?? "A team member");
          const managerName = (`${manager.firstName ?? ""} ${manager.lastName ?? ""}`.trim()) || manager.email;
          sendSubordinateLeadNotification(manager.email, managerName, creatorName, lead.companyName).catch(() => {});
        }
      }
    } catch {}
  }).catch(() => {});

  const dto = await getLeadWithDetails(lead.id);
  res.status(201).json(dto);
});

router.post("/leads/bulk", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = BulkLeadActionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { leadIds, action, stageId, ownerId } = parsed.data;
  const wid = req.user.workspaceId ?? null;

  // Pre-compute scope and restrict leadIds to only those the caller may act on
  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let scopedLeadIds: number[];
  if (allowedOwnerIds === null) {
    // Admin: full access — still scope to workspace
    if (leadIds.length === 0) { res.json({ affected: 0, message: "0 leads updated" }); return; }
    const leads = await db.select({ id: leadsTable.id })
      .from(leadsTable)
      .where(and(inArray(leadsTable.id, leadIds), wsFilter(leadsTable.workspaceId, wid)));
    scopedLeadIds = leads.map(l => l.id);
  } else {
    // Fetch the requested leads in one query and filter by scope + workspace
    if (leadIds.length === 0) { res.json({ affected: 0, message: "0 leads updated" }); return; }
    const leads = await db.select({ id: leadsTable.id, ownerId: leadsTable.ownerId })
      .from(leadsTable)
      .where(and(inArray(leadsTable.id, leadIds), wsFilter(leadsTable.workspaceId, wid)));
    scopedLeadIds = leads
      .filter(l => l.ownerId !== null && allowedOwnerIds.includes(l.ownerId))
      .map(l => l.id);
  }

  if (scopedLeadIds.length === 0) {
    res.json({ affected: 0, message: "0 leads updated" }); return;
  }

  let affected = 0;

  if (action === "change_stage" && stageId) {
    // BD cannot bulk-reassign stages
    if (req.user.role === "bd") { res.status(403).json({ error: "Forbidden" }); return; }
    const newStage = await getLostStage(stageId, wid);
    if (!newStage) { res.status(400).json({ error: "Invalid lead stage" }); return; }
    const existingStages = await db.select({ id: leadsTable.id, stageId: leadsTable.stageId })
      .from(leadsTable).where(and(inArray(leadsTable.id, scopedLeadIds), wsFilter(leadsTable.workspaceId, wid)));
    const changed = existingStages.filter(l => isStageTransition(l.stageId, stageId));
    if (changed.length) {
      await db.update(leadsTable).set({ stageId }).where(inArray(leadsTable.id, changed.map(l => l.id)));
      await Promise.all(changed.map(l => logActivity(l.id, "stage_changed",
        `Stage changed via bulk action to ${newStage.name}`, req.user.id,
        undefined, lostActivityMarker(newStage.isLost, newStage.name), wid)));
    }
    affected = changed.length;
  } else if (action === "assign" && ownerId !== undefined) {
    // BD cannot bulk-reassign owners
    if (req.user.role === "bd") { res.status(403).json({ error: "Forbidden" }); return; }
    await db.update(leadsTable).set({ ownerId }).where(inArray(leadsTable.id, scopedLeadIds));
    affected = scopedLeadIds.length;
    await Promise.all(scopedLeadIds.map(id => logActivity(id, "assigned", `Lead assigned via bulk action`, req.user.id, undefined, undefined, wid)));

    // Fire-and-forget in-app + email notification per lead (mirrors single-lead assign)
    if (ownerId) {
      const _ownerId = ownerId;
      Promise.resolve().then(async () => {
        try {
          const bulkLeads = await db
            .select({ id: leadsTable.id, companyName: leadsTable.companyName })
            .from(leadsTable)
            .where(inArray(leadsTable.id, scopedLeadIds));

          const [assigner] = await db.select({
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
          }).from(usersTable).where(eq(usersTable.numId, req.user.id));
          const assignerName = assigner
            ? ((`${assigner.firstName ?? ""} ${assigner.lastName ?? ""}`).trim() || (assigner.email ?? "Someone"))
            : "Someone";

          // One in-app notification per lead
          for (const bl of bulkLeads) {
            await db.insert(notificationsTable).values({
              userId: _ownerId,
              type: "lead_assigned",
              title: `Lead assigned to you: ${bl.companyName}`,
              body: `Assigned by ${assignerName}`,
              leadId: bl.id,
              workspaceId: wid,
            }).catch(() => {});
          }

          // One summary email for all leads, gated by shouldNotify.
          // Single lead: individual email (consistent with single-lead assign path).
          // Multiple leads: one summary email listing all affected companies.
          if (bulkLeads.length > 0 && await shouldNotify(_ownerId, "notifyNewLead")) {
            const [owner] = await db.select({
              email: usersTable.email,
              firstName: usersTable.firstName,
              lastName: usersTable.lastName,
            }).from(usersTable).where(eq(usersTable.numId, _ownerId));
            if (owner?.email) {
              const ownerName = ((`${owner.firstName ?? ""} ${owner.lastName ?? ""}`).trim() || owner.email);
              if (bulkLeads.length === 1) {
                await sendLeadAssignedNotification(owner.email, ownerName, bulkLeads[0].companyName, assignerName).catch(() => {});
              } else {
                await sendBulkLeadAssignedNotification(
                  owner.email,
                  ownerName,
                  bulkLeads.map(bl => bl.companyName),
                  assignerName,
                ).catch(() => {});
              }
            }
          }
        } catch {}
      }).catch(() => {});
    }
  } else if (action === "delete") {
    let deletableIds = scopedLeadIds;
    if (req.user.role !== "admin") {
      // Non-admins may only bulk-delete leads they personally created or are assigned to as owner
      const ownerRows = await db.select({ id: leadsTable.id, createdById: leadsTable.createdById, ownerId: leadsTable.ownerId })
        .from(leadsTable)
        .where(inArray(leadsTable.id, scopedLeadIds));
      deletableIds = ownerRows.filter(l => l.createdById === req.user.id || l.ownerId === req.user.id).map(l => l.id);
    }
    if (deletableIds.length > 0) {
      await db.delete(leadsTable).where(inArray(leadsTable.id, deletableIds));
    }
    affected = deletableIds.length;
  }

  res.json({ affected, message: `${affected} leads updated` });
});

// ── Semantic column mapping ───────────────────────────────────────────────────
// Maps every common header variant (lowercase, trimmed) → our canonical field name.
const FIELD_SYNONYMS: Record<string, string> = {
  // companyName
  company: "companyName", "company name": "companyName", organisation: "companyName",
  organization: "companyName", org: "companyName", business: "companyName",
  "business name": "companyName", firm: "companyName", account: "companyName",
  "account name": "companyName", company_name: "companyName", "client name": "companyName",
  "property developer": "companyName", developer: "companyName", "company/organisation": "companyName",

  // contactPerson
  contact: "contactPerson", "contact person": "contactPerson", name: "contactPerson",
  "full name": "contactPerson", "contact name": "contactPerson", person: "contactPerson",
  "lead name": "contactPerson", "client": "contactPerson", contact_person: "contactPerson",
  // "Poc Name" is the contact-person header in the downloadable Lead Import Template.
  poc: "contactPerson", "poc name": "contactPerson", "point of contact": "contactPerson", representative: "contactPerson",
  "contact/person": "contactPerson", salesperson: "contactPerson", "bd name": "contactPerson",

  // email
  email: "email", "email address": "email", "e-mail": "email", e_mail: "email",
  mail: "email", "mail id": "email", "email id": "email", emailid: "email", "work email": "email",

  // phone
  phone: "phone", "phone number": "phone", mobile: "phone", "mobile number": "phone",
  cell: "phone", "cell phone": "phone", telephone: "phone", tel: "phone",
  "contact number": "phone", whatsapp: "phone", "phone/mobile": "phone", "mobile/phone": "phone",

  // location
  location: "location", city: "location", address: "location", region: "location",
  area: "location", country: "location", state: "location", place: "location",
  "city/location": "location", "location/city": "location",

  // industry
  industry: "industry", sector: "industry", vertical: "industry", "business type": "industry",
  category: "industry", domain: "industry", "property type": "industry", "asset type": "industry",

  // designation
  designation: "designation", title: "designation", "job title": "designation",
  position: "designation", "job role": "designation", jobtitle: "designation",

  // source / channel
  source: "source", "lead source": "source", origin: "source", "referred by": "source",
  "how found": "source", "source channel": "source", "acquisition source": "source",
  channel: "channel", "marketing channel": "channel", medium: "channel",

  // remarks / notes
  remarks: "remarks", notes: "remarks", note: "remarks", comments: "remarks",
  comment: "remarks", description: "remarks", details: "remarks", info: "remarks",
  "pain points": "remarks", requirements: "remarks", "client requirements": "remarks",

  // priority / temperature
  priority: "priority", temperature: "priority", urgency: "priority",
  "lead temperature": "priority", "hot/warm/cold": "priority", "lead priority": "priority",
  status: "priority", "lead status": "priority",

  // valueAmount
  value: "valueAmount", "deal value": "valueAmount", amount: "valueAmount",
  revenue: "valueAmount", budget: "valueAmount", "potential value": "valueAmount",
  "property size": "valueAmount", size: "valueAmount", "sqft": "valueAmount",

  // website / linkedin
  website: "websiteUrl", url: "websiteUrl", web: "websiteUrl", site: "websiteUrl",
  "website url": "websiteUrl", linkedin: "linkedinUrl", "linkedin url": "linkedinUrl",
  "linkedin profile": "linkedinUrl",
};

/**
 * Normalise a raw CSV row (any column names) into our canonical field names.
 * Also handles "Company | Contact" combined cells and splits them.
 */
function normalizeImportRow(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, val] of Object.entries(raw)) {
    if (val === undefined || val === null) continue;
    const normalKey = key.trim().toLowerCase().replace(/\s+/g, " ");
    const mapped = FIELD_SYNONYMS[normalKey] ?? normalKey;
    // Last value wins so more specific keys override generic ones
    out[mapped] = String(val).trim();
  }

  // Attempt to split "Company / Contact" or "Company - Contact" combined fields
  const company = out.companyName ?? "";
  const contact = out.contactPerson ?? "";
  if (company && !contact) {
    // Try " - ", " / ", " | " as separator between company and person
    const m = company.match(/^(.+?)(?:\s[-/|]\s|\s{2,})([A-Z][a-z]+ [A-Z][a-z]+)$/);
    if (m) {
      out.companyName = m[1].trim();
      out.contactPerson = m[2].trim();
    }
  }

  // Normalise priority synonyms
  if (out.priority) {
    const p = out.priority.toLowerCase();
    if (["hot", "high", "urgent", "1"].includes(p)) out.priority = "hot";
    else if (["warm", "medium", "normal", "2"].includes(p)) out.priority = "warm";
    else if (["cold", "low", "3"].includes(p)) out.priority = "cold";
    else out.priority = "";
  }

  return out;
}

router.post("/leads/import", requirePermission("leads.import"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = ImportLeadsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const dryRun = req.query.dryRun === "true" || req.body.dryRun === true;
  const wid = req.user.workspaceId ?? null;

  // Normalize every row's column names using semantic mapping
  const rows = parsed.data.rows.map(r => normalizeImportRow(r as Record<string, string>));

  // ── Phase 1: Validate all rows before committing any inserts ──────────
  const validationErrors: { row: number; message: string }[] = [];

  const incomingEmails = rows.map(r => r.email?.trim().toLowerCase()).filter(Boolean) as string[];
  const existingEmailRows = incomingEmails.length > 0
    ? await db.select({ email: leadsTable.email }).from(leadsTable).where(and(inArray(leadsTable.email, incomingEmails), wsFilter(leadsTable.workspaceId, wid)))
    : [];
  const existingEmails = new Set(existingEmailRows.map(r => r.email?.toLowerCase()).filter(Boolean) as string[]);
  const batchEmails = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.companyName) {
      validationErrors.push({ row: i + 1, message: "Missing company name — could not map any column to 'Company'" });
    }
    const rowEmail = row.email?.trim().toLowerCase();
    if (rowEmail) {
      if (existingEmails.has(rowEmail)) {
        validationErrors.push({ row: i + 1, message: `Duplicate email: ${row.email} already exists in the system` });
      } else if (batchEmails.has(rowEmail)) {
        validationErrors.push({ row: i + 1, message: `Duplicate email: ${row.email} appears more than once in this import` });
      } else {
        batchEmails.add(rowEmail);
      }
    }
  }

  if (dryRun || validationErrors.length > 0) {
    const valid = rows.length - validationErrors.length;
    // Return a sample of mapped column names so the UI can show what was detected
    const detectedFields = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({
      dryRun: true,
      valid,
      failed: validationErrors.length,
      errors: validationErrors,
      detectedFields,
      message: dryRun
        ? `Validation complete: ${valid} rows OK, ${validationErrors.length} issues found`
        : `${validationErrors.length} validation error(s) — fix before importing`,
    });
    return;
  }

  // ── Phase 2: Commit validated rows ────────────────────────────────────
  // Same type="lead" scoping fix as POST /leads above — see that comment.
  const [firstStage] = await db.select().from(stagesTable)
    .where(eq(stagesTable.type, "lead"))
    .orderBy(stagesTable.order);
  let created = 0;
  const insertErrors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const [lead] = await db.insert(leadsTable).values({
        companyName: row.companyName ?? "Unknown",
        contactPerson: row.contactPerson ?? row.name ?? "Unknown",
        email: row.email || null,
        phone: row.phone || null,
        location: row.location || null,
        designation: row.designation || null,
        industry: row.industry || null,
        remarks: row.remarks || null,
        source: (["manual","csv_import","api","web_form"].includes(row.source ?? "") ? row.source : "csv_import") as "manual" | "csv_import" | "api" | "web_form",
        channel: (["website","whatsapp","instagram","email","apollo","referral","linkedin","database","other"].includes(row.channel ?? "")) ? row.channel as any : null,
        priority: (["hot","warm","cold"].includes(row.priority ?? "")) ? row.priority as any : null,
        websiteUrl: row.websiteUrl || null,
        linkedinUrl: row.linkedinUrl || null,
        valueAmount: row.valueAmount && !isNaN(Number(row.valueAmount)) ? row.valueAmount : null,
        stageId: firstStage?.id,
        ownerId: req.user.id,
        createdById: req.user.id,
        workspaceId: wid,
      }).returning();
      await logActivity(lead.id, "imported", `Lead imported from CSV`, req.user.id, undefined, undefined, wid);
      created++;
    } catch {
      insertErrors.push({ row: i + 1, message: "Failed to insert row" });
    }
  }

  res.json({ created, failed: insertErrors.length, errors: insertErrors });
});

// NOTE: /leads/export must be declared before /leads/:id to avoid route shadowing
router.get("/leads/export", requirePermission("leads.export"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let rows = await db.select({ lead: leadsTable, stage: stagesTable, owner: usersTable })
    .from(leadsTable)
    .leftJoin(stagesTable, eq(leadsTable.stageId, stagesTable.id))
    .leftJoin(usersTable, eq(leadsTable.ownerId, usersTable.numId))
    .where(wsFilter(leadsTable.workspaceId, wid))
    .orderBy(desc(leadsTable.createdAt));

  if (allowedOwnerIds !== null) {
    rows = rows.filter(r =>
      r.lead.createdById === req.user.id ||
      (r.lead.ownerId !== null && allowedOwnerIds.includes(r.lead.ownerId))
    );
  }

  const headers = ["ID", "Company", "Contact", "Email", "Phone", "Stage", "Priority", "Source", "Owner", "Location", "Industry", "Created"];
  const csvRows = rows.map(r => [
    r.lead.id, r.lead.companyName, r.lead.contactPerson, r.lead.email ?? "",
    r.lead.phone ?? "", r.stage?.name ?? "", r.lead.priority ?? "", r.lead.source ?? "",
    r.owner ? `${r.owner.firstName ?? ""} ${r.owner.lastName ?? ""}`.trim() : "",
    r.lead.location ?? "", r.lead.industry ?? "",
    r.lead.createdAt.toISOString().split("T")[0],
  ]);

  const csv = [headers, ...csvRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=leads-export.csv");
  res.send(csv);
});

router.get("/leads/:id", requirePermission("leads.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetLeadParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  // Scope check
  if (!(await canAccessLead(req.user, lead))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [stage] = lead.stageId ? await db.select().from(stagesTable).where(eq(stagesTable.id, lead.stageId)) : [null];
  const [owner] = lead.ownerId ? await db.select().from(usersTable).where(eq(usersTable.numId, lead.ownerId)) : [null];
  const [createdBy] = lead.createdById ? await db.select().from(usersTable).where(eq(usersTable.numId, lead.createdById)) : [null];

  const notes = await db.select().from(notesTable).where(eq(notesTable.leadId, params.data.id));
  const followups = await db.select().from(followupsTable).where(eq(followupsTable.leadId, params.data.id));
  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.leadId, params.data.id));
  const tags = await getTagsForLead(params.data.id);

  res.json({
    ...lead,
    stageName: stage?.name ?? null,
    stageColor: stage?.color ?? null,
    ownerName: owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || (owner.email?.split("@")[0] ?? null) : null,
    ownerAvatar: owner?.profileImageUrl ?? null,
    createdByName: createdBy ? `${createdBy.firstName ?? ""} ${createdBy.lastName ?? ""}`.trim() || (createdBy.email?.split("@")[0] ?? null) : null,
    tags,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    expectedCloseDate: lead.expectedCloseDate?.toISOString() ?? null,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    lostAt: await getLatestLostAt(lead.id, wid),
    notes: notes.map(n => ({ ...n, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() })),
    followups: followups.map(f => ({ ...f, scheduledAt: f.scheduledAt.toISOString(), createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() })),
    activities: activities.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
  });
});

router.patch("/leads/:id", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateLeadParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateLeadBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), wsFilter(leadsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await canAccessLead(req.user, existing))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // Explicitly whitelist updatable fields — never spread raw body data into DB
  const {
    companyName, contactPerson, email, phone, location, designation, industry,
    linkedinUrl, websiteUrl, remarks, comment, priority, channel, valueAmount, currency,
    stageId, ownerId,
    tagIds, expectedCloseDate, nextFollowUpAt,
  } = body.data as any;

  const updateData: Record<string, unknown> = {};
  if (companyName !== undefined) updateData.companyName = companyName;
  if (contactPerson !== undefined) updateData.contactPerson = contactPerson;
  if (email !== undefined) updateData.email = email;
  if (phone !== undefined) updateData.phone = phone;
  if (location !== undefined) updateData.location = location;
  if (designation !== undefined) updateData.designation = designation;
  if (industry !== undefined) updateData.industry = industry;
  if (linkedinUrl !== undefined) updateData.linkedinUrl = linkedinUrl;
  if (websiteUrl !== undefined) updateData.websiteUrl = websiteUrl;
  if (remarks !== undefined) updateData.remarks = remarks;
  if (comment !== undefined) updateData.comment = comment;
  if (priority !== undefined) updateData.priority = priority;
  if (channel !== undefined) updateData.channel = channel;
  if (valueAmount !== undefined) updateData.valueAmount = valueAmount;
  if (currency !== undefined) updateData.currency = currency;
  if (stageId !== undefined) updateData.stageId = stageId;
  const newStage = stageId !== undefined && isStageTransition(existing.stageId, stageId)
    ? await getLostStage(stageId, wid) : null;
  if (newStage === undefined) { res.status(400).json({ error: "Invalid lead stage" }); return; }
  // Only admins and managers may reassign ownership — BD users keep their own leads
  if (ownerId !== undefined && req.user.role !== "bd") {
    updateData.ownerId = ownerId;
  }
  if (expectedCloseDate !== undefined) {
    updateData.expectedCloseDate = expectedCloseDate && expectedCloseDate !== "" ? new Date(expectedCloseDate) : null;
  }
  if (nextFollowUpAt !== undefined) {
    updateData.nextFollowUpAt = nextFollowUpAt && nextFollowUpAt !== "" ? new Date(nextFollowUpAt) : null;
  }

  let lead: typeof leadsTable.$inferSelect;
  try {
    const [updated] = await db.update(leadsTable).set(updateData).where(eq(leadsTable.id, params.data.id)).returning();
    lead = updated;
  } catch (err) {
    res.status(500).json({ error: "Failed to update lead. Check that all field values are valid." });
    return;
  }

  if (Array.isArray(tagIds)) {
    await setTagsForLead(lead.id, tagIds);
  }

  await logActivity(lead.id, "updated", `Lead updated`, req.user.id, undefined, undefined, wid);
  if (newStage) {
    const oldStage = existing.stageId ? await getLostStage(existing.stageId, wid) : null;
    await logActivity(lead.id, "stage_changed",
      `Stage changed from ${oldStage?.name ?? "None"} to ${newStage.name}`,
      req.user.id, oldStage?.name ?? undefined, lostActivityMarker(newStage.isLost, newStage.name), wid);
  }
  await logAudit(lead.id, req.user.id, "update", "lead", JSON.stringify(existing), JSON.stringify(lead), req.ip ?? undefined, wid);
  await evaluateAutomationRules("field_value", null, lead.id, req.user.id, wid).catch(() => {});

  // Notify new owner when ownership changed via general edit (genuine bug: was missing here)
  const ownerChanged = ownerId !== undefined && lead.ownerId !== null && lead.ownerId !== existing.ownerId;
  if (ownerChanged && lead.ownerId !== req.user.id) {
    await db.insert(notificationsTable).values({
      userId: lead.ownerId!,
      type: "lead_assigned",
      title: `Lead assigned to you: ${lead.companyName}`,
      body: `Contact: ${lead.contactPerson ?? ""}`,
      leadId: lead.id,
      workspaceId: wid,
    }).catch(() => {});

    Promise.resolve().then(async () => {
      try {
        if (await shouldNotify(lead.ownerId!, "notifyNewLead")) {
          const [owner] = await db.select().from(usersTable).where(eq(usersTable.numId, lead.ownerId!));
          const [assigner] = await db.select().from(usersTable).where(eq(usersTable.numId, req.user.id));
          if (owner?.email) {
            const ownerName = (`${owner.firstName ?? ""} ${owner.lastName ?? ""}`).trim() || owner.email;
            const assignerName = assigner
              ? ((`${assigner.firstName ?? ""} ${assigner.lastName ?? ""}`).trim() || (assigner.email ?? "Someone"))
              : "Someone";
            sendLeadAssignedNotification(owner.email, ownerName, lead.companyName, assignerName).catch(() => {});
          }
        }
      } catch {}
    }).catch(() => {});
  }

  const dto = await getLeadWithDetails(lead.id);
  res.json(dto);
});

router.delete("/leads/:id", requirePermission("leads.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = DeleteLeadParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), wsFilter(leadsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  // Non-admin: can delete only leads they created OR are assigned to as owner
  if (req.user.role !== "admin") {
    const isOwner = existing.ownerId === req.user.id;
    const isCreator = existing.createdById === req.user.id;
    if (!isOwner && !isCreator) {
      res.status(403).json({ error: "You can only delete leads you own or created" }); return;
    }
  }

  await db.delete(leadsTable).where(eq(leadsTable.id, params.data.id));
  res.status(204).send();
});

router.patch("/leads/:id/assign", requirePermission("leads.assign"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role === "bd") { res.status(403).json({ error: "Forbidden" }); return; }
  const params = AssignLeadParams.safeParse({ id: Number(req.params.id) });
  const body = AssignLeadBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), wsFilter(leadsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await canAccessLead(req.user, existing))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // Managers may only assign leads to members of their own team
  if (req.user.role === "manager" && body.data.ownerId !== null && body.data.ownerId !== undefined) {
    const allowedIds = await getAllowedOwnerIds(req.user as ScopeUser);
    if (allowedIds !== null && !allowedIds.includes(body.data.ownerId)) {
      res.status(403).json({ error: "Forbidden: assignee is not in your team" }); return;
    }
  }

  const prev = existing;
  const [lead] = await db.update(leadsTable).set({ ownerId: body.data.ownerId }).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }

  await logActivity(lead.id, "assigned", `Lead assigned to user ${body.data.ownerId}`, req.user.id, String(prev?.ownerId), String(body.data.ownerId), wid);
  await logAudit(lead.id, req.user.id, "assign", "owner_id", String(prev?.ownerId), String(body.data.ownerId), req.ip ?? undefined, wid);

  // Notify the new assignee (in-app + email)
  if (body.data.ownerId && body.data.ownerId !== req.user.id) {
    await db.insert(notificationsTable).values({
      userId: body.data.ownerId,
      type: "lead_assigned",
      title: `Lead assigned to you: ${lead.companyName}`,
      body: `Contact: ${lead.contactPerson}`,
      leadId: lead.id,
      workspaceId: wid,
    }).catch(() => {});

    // Email the new assignee if opted in
    Promise.resolve().then(async () => {
      try {
        if (await shouldNotify(body.data.ownerId!, "notifyNewLead")) {
          const [owner] = await db.select().from(usersTable).where(eq(usersTable.numId, body.data.ownerId!));
          const [assigner] = await db.select().from(usersTable).where(eq(usersTable.numId, req.user.id));
          if (owner?.email) {
            const ownerName = (`${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim()) || owner.email;
            const assignerName = assigner
              ? ((`${assigner.firstName ?? ""} ${assigner.lastName ?? ""}`.trim()) || (assigner.email ?? "Someone"))
              : "Someone";
            sendLeadAssignedNotification(owner.email, ownerName, lead.companyName, assignerName).catch(() => {});
          }
        }
      } catch {}
    }).catch(() => {});
  }

  const dto = await getLeadWithDetails(lead.id);
  res.json(dto);
});

router.patch("/leads/:id/stage", requirePermission("pipeline.move_stage"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateLeadStageParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateLeadStageBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, params.data.id), wsFilter(leadsTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await canAccessLead(req.user, existing))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [oldStage] = existing.stageId ? await db.select().from(stagesTable).where(eq(stagesTable.id, existing.stageId)) : [null];
  const newStage = await getLostStage(body.data.stageId, wid);
  if (!newStage) { res.status(400).json({ error: "Invalid lead stage" }); return; }
  if (!isStageTransition(existing.stageId, body.data.stageId)) {
    res.json(await getLeadWithDetails(existing.id));
    return;
  }

  const [lead] = await db.update(leadsTable).set({ stageId: body.data.stageId }).where(eq(leadsTable.id, params.data.id)).returning();
  await logActivity(lead.id, "stage_changed", `Stage changed from ${oldStage?.name ?? "None"} to ${newStage.name}`, req.user.id, oldStage?.name ?? undefined, lostActivityMarker(newStage.isLost, newStage.name), wid);
  await logAudit(lead.id, req.user.id, "stage_change", "stage_id", oldStage?.name ?? undefined, newStage?.name ?? undefined, req.ip ?? undefined, wid);
  await evaluateAutomationRules("stage_change", newStage?.name ?? null, lead.id, req.user.id, wid).catch(() => {});

  // Email the lead owner about the stage change if opted in
  if (lead.ownerId && lead.ownerId !== req.user.id) {
    Promise.resolve().then(async () => {
      try {
        if (await shouldNotify(lead.ownerId!, "notifyStatusChange")) {
          const [owner] = await db.select().from(usersTable).where(eq(usersTable.numId, lead.ownerId!));
          if (owner?.email) {
            const ownerName = (`${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim()) || owner.email;
            sendStageChangeNotification(
              owner.email, ownerName, lead.companyName,
              oldStage?.name ?? "None", newStage?.name ?? "Unknown"
            ).catch(() => {});
          }
        }
      } catch {}
    }).catch(() => {});
  }

  const dto = await getLeadWithDetails(lead.id);
  res.json(dto);
});

router.post("/leads/:id/convert", requirePermission("leads.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [lead] = await db.select().from(leadsTable)
    .where(and(eq(leadsTable.id, id), wsFilter(leadsTable.workspaceId, wid)));
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessLead(req.user, lead))) { res.status(403).json({ error: "Forbidden" }); return; }

  const {
    contactFirstName, contactLastName, contactEmail, contactPhone,
    accountName, dealName, dealValue, dealStageId, dealCloseDate,
    createDeal = true, createAccount = true,
  } = req.body;

  const firstName = contactFirstName?.trim() || lead.contactPerson.split(" ")[0] || lead.contactPerson;
  const lastName = contactLastName?.trim() || lead.contactPerson.split(" ").slice(1).join(" ") || null;

  // Guard: block duplicate deal creation if one already exists for this lead
  if (createDeal) {
    const [existingDeal] = await db.select({ id: dealsTable.id, name: dealsTable.name })
      .from(dealsTable)
      .where(and(eq(dealsTable.convertedFromLeadId, id), wsFilter(dealsTable.workspaceId, wid)));
    if (existingDeal) {
      res.status(409).json({ error: "deal_exists", dealId: existingDeal.id, dealName: existingDeal.name });
      return;
    }
  }

  // Resolve deal stageId outside the transaction (read-only query).
  // Prefer the "Active" deal stage; fall back to the first deal-type stage by order.
  let resolvedDealStageId = dealStageId;
  if (createDeal && !resolvedDealStageId) {
    // Deal stages are seeded globally (workspaceId = NULL) — scope to NULL,
    // not the user's workspace, to find Active/Won/Lost correctly.
    const [activeStage] = await db.select().from(stagesTable)
      .where(and(isNull(stagesTable.workspaceId), eq(stagesTable.type, "deal")))
      .orderBy(stagesTable.order);
    resolvedDealStageId = activeStage?.id;
  }

  // Atomically create all records and mark the lead converted
  let contactId: number;
  let accountId: number | null = null;
  let dealId: number | null = null;

  // Resolved email/phone for contact lookup (outside transaction is fine — read-only)
  const resolvedEmail = contactEmail?.trim() || lead.email || null;

  try {
    await db.transaction(async (tx) => {
      // ── Account: reuse existing by name in this workspace, don't duplicate ──
      if (createAccount) {
        const aName = accountName?.trim() || lead.companyName;
        const [existingAccount] = await tx
          .select({ id: accountsTable.id })
          .from(accountsTable)
          .where(and(
            eq(accountsTable.name, aName),
            wsFilter(accountsTable.workspaceId, wid),
          ));
        if (existingAccount) {
          accountId = existingAccount.id;
        } else {
          const [account] = await tx.insert(accountsTable).values({
            name: aName,
            industry: lead.industry ?? null,
            website: lead.websiteUrl ?? null,
            location: lead.location ?? null,
            ownerId: lead.ownerId,
            createdById: req.user.id,
            workspaceId: wid,
          }).returning();
          accountId = account.id;
        }
      }

      // ── Contact: reuse existing by email (then by full name), don't duplicate ──
      let existingContact: { id: number } | undefined;
      if (resolvedEmail) {
        [existingContact] = await tx
          .select({ id: contactsTable.id })
          .from(contactsTable)
          .where(and(
            eq(contactsTable.email, resolvedEmail),
            wsFilter(contactsTable.workspaceId, wid),
          ));
      }
      if (!existingContact) {
        [existingContact] = await tx
          .select({ id: contactsTable.id })
          .from(contactsTable)
          .where(and(
            eq(contactsTable.firstName, firstName),
            lastName ? eq(contactsTable.lastName, lastName) : isNull(contactsTable.lastName),
            wsFilter(contactsTable.workspaceId, wid),
          ));
      }
      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const [contact] = await tx.insert(contactsTable).values({
          firstName,
          lastName,
          email: resolvedEmail,
          phone: contactPhone?.trim() || lead.phone || null,
          title: lead.designation ?? null,
          accountId,
          ownerId: lead.ownerId,
          createdById: req.user.id,
          notes: lead.remarks ?? null,
          workspaceId: wid,
        }).returning();
        contactId = contact.id;
      }

      if (createDeal) {
        const initialValue = dealValue || lead.valueAmount || null;
        const [deal] = await tx.insert(dealsTable).values({
          name: dealName?.trim() || lead.companyName,
          // value starts null; set below via revenue entry so syncDealValue tracks it correctly
          value: null,
          currency: lead.currency ?? "INR",
          stageId: resolvedDealStageId ?? null,
          closeDate: dealCloseDate ? new Date(dealCloseDate) : (lead.expectedCloseDate ?? null),
          accountId,
          contactId,
          convertedFromLeadId: id,
          ownerId: lead.ownerId,
          createdById: req.user.id,
          workspaceId: wid,
        }).returning();
        dealId = deal.id;

        // Insert an initial revenue entry so syncDealValue always has a source-of-truth row.
        // Writing directly to deals.value (bypassing entries) caused the value to be silently
        // wiped the first time Finance added/edited/deleted any entry.
        if (initialValue) {
          const now = new Date();
          const entryMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
          await tx.insert(dealRevenueEntriesTable).values({
            dealId: deal.id,
            amount: String(initialValue),
            month: entryMonth,
            note: "Initial deal value from lead conversion",
            createdById: req.user.id,
            workspaceId: wid,
          });
          // Sync the cached deal.value to the entry sum
          await tx.update(dealsTable)
            .set({ value: String(initialValue) })
            .where(eq(dealsTable.id, deal.id));
        }
      }

      // Mark the lead as converted inside the transaction
      await tx.update(leadsTable).set({
        isConverted: true,
        convertedAt: new Date(),
      }).where(eq(leadsTable.id, id));
    });
  } catch (err: any) {
    req.log.error({ err }, "Lead conversion failed");
    res.status(500).json({ error: "Conversion failed. Please try again." });
    return;
  }

  await logActivity(id, "updated", `Lead converted to Contact${accountId ? " + Account" : ""}${dealId ? " + Deal" : ""}`, req.user.id, undefined, undefined, wid);
  await logAudit(id, req.user.id, "convert", "is_converted", "false", "true", req.ip ?? undefined, wid);

  res.json({ contactId: contactId!, accountId, dealId, message: "Lead converted successfully" });
});

export default router;
