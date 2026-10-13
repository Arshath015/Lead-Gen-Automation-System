import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, stagesTable, followupsTable, scheduledActivitiesTable, usersTable, dealsTable, dealRevenueEntriesTable } from "@workspace/db";
import { eq, and, lt, lte, gte, count, inArray, isNull, sql, or, asc, desc } from "drizzle-orm";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { leadClassificationDateSql } from "../lib/lead-classification";
import { parseLeadRangeEndExclusive, parseLeadRangeStart } from "../lib/lead-date-range";
import { newestFollowupsFirst } from "../lib/dashboard-ordering";
import { activeFollowups, followupDueCounts } from "../lib/followup-due";

const router: IRouter = Router();

function parseOwnerIdParam(val: unknown, role: string | undefined): number | undefined {
  if (role === "bd") return undefined;
  if (typeof val !== "string" || !val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

async function buildLeadConditions(
  user: Express.User,
  from?: Date,
  to?: Date,
  ownerIdOverride?: number,
): Promise<Parameters<typeof and>[]> {
  const conditions: Parameters<typeof and>[] = [];

  // Always scope to the caller's workspace
  conditions.push(wsFilter(leadsTable.workspaceId, user.workspaceId ?? null) as any);

  if (ownerIdOverride !== undefined) {
    const allowedOwnerIds = await getAllowedOwnerIds(user as ScopeUser);
    const isAllowed = allowedOwnerIds === null || allowedOwnerIds.includes(ownerIdOverride);
    if (isAllowed) {
      conditions.push(eq(leadsTable.ownerId, ownerIdOverride) as any);
    } else {
      const ids = allowedOwnerIds?.length ? allowedOwnerIds : [user.id];
      conditions.push(inArray(leadsTable.ownerId, ids) as any);
    }
  } else {
    const allowedOwnerIds = await getAllowedOwnerIds(user as ScopeUser);
    if (allowedOwnerIds !== null) {
      if (allowedOwnerIds.length === 0) {
        // "own" scope: leads owned by OR created by this user
        conditions.push(or(
          eq(leadsTable.ownerId, user.id),
          eq(leadsTable.createdById, user.id),
        ) as any);
      } else {
        // "team" scope: leads owned by OR created by any team member
        conditions.push(or(
          inArray(leadsTable.ownerId, allowedOwnerIds),
          inArray(leadsTable.createdById, allowedOwnerIds),
        ) as any);
      }
    }
  }

  if (from) conditions.push(gte(leadClassificationDateSql, from) as any);
  if (to) conditions.push(lt(leadClassificationDateSql, to) as any);

  return conditions;
}

router.get("/dashboard/stats", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const from = parseLeadRangeStart(req.query.from);
  const to = parseLeadRangeEndExclusive(req.query.to);
  const ownerIdOverride = parseOwnerIdParam(req.query.ownerId, req.user.role);
  const conditions = await buildLeadConditions(req.user, from, to, ownerIdOverride);
  const baseWhere = conditions.length > 0 ? and(...(conditions as any[])) : undefined;

  const wid = req.user.workspaceId ?? null;
  // Lead stages are workspace-scoped (type='lead') — drives pipeline / active-lead counts.
  // Deal stages are ALWAYS global (workspaceId=null, type='deal'). They are seeded with
  // workspaceId=null, so wsFilter would exclude them for workspace users and produce 0 for
  // every deal metric (won/lost/conversion/avg size).  Must query them with isNull() instead.
  const leadStages = await db.select().from(stagesTable)
    .where(and(wsFilter(stagesTable.workspaceId, wid), eq(stagesTable.type, "lead")));
  const dealStages = await db.select().from(stagesTable)
    .where(and(isNull(stagesTable.workspaceId), eq(stagesTable.type, "deal")));

  const newStage        = leadStages.find(s => s.order === 0);
  const wonLeadStageIds    = leadStages.filter(s => s.isWon).map(s => s.id);
  const lostLeadStageIds   = leadStages.filter(s => s.isLost).map(s => s.id);
  const wonDealStageIds    = dealStages.filter(s => s.isWon).map(s => s.id);
  const lostDealStageIds   = dealStages.filter(s => s.isLost).map(s => s.id);
  const activeDealStageIds = dealStages.filter(s => !s.isWon && !s.isLost).map(s => s.id);

  const [totalResult] = await db.select({ count: count() }).from(leadsTable).where(baseWhere);
  const total = totalResult?.count ?? 0;

  const newConditions = newStage ? [...conditions, eq(leadsTable.stageId, newStage.id) as any] : null;
  const [newResult] = newConditions
    ? await db.select({ count: count() }).from(leadsTable).where(and(...(newConditions as any[])))
    : [{ count: 0 }];

  // Active leads = leads NOT in won/lost LEAD stages
  const allWonLostIds = [...wonLeadStageIds, ...lostLeadStageIds];
  let activeLeadsCount = total;
  if (allWonLostIds.length > 0) {
    const [wonLostLeads] = await db.select({ count: count() }).from(leadsTable)
      .where(and(baseWhere, inArray(leadsTable.stageId, allWonLostIds)));
    activeLeadsCount = total - (wonLostLeads?.count ?? 0);
  }

  const scopeConditions = ownerIdOverride !== undefined
    ? await buildLeadConditions(req.user, undefined, undefined, ownerIdOverride)
    : await buildLeadConditions(req.user);
  const scopeWhere = scopeConditions.length > 0 ? and(...(scopeConditions as any[])) : undefined;

  const now = new Date();
  let dueCount = 0;
  const scopedLeads = await db.select({ id: leadsTable.id }).from(leadsTable).where(scopeWhere);
  const scopedLeadIds = scopedLeads.map(l => l.id);
  if (scopedLeadIds.length > 0) {
    const [dueResult] = await db.select({ count: count() }).from(followupsTable)
      .where(and(
        eq(followupsTable.status, "pending"),
        lte(followupsTable.scheduledAt, now),
        inArray(followupsTable.leadId, scopedLeadIds),
      ));
    dueCount = dueResult?.count ?? 0;
  }

  // ── Lead-based Won/Lost/Conversion ────────────────────────────────────────
  // Won, Lost, and Conversion use Lead stage flags (isWon/isLost) — these
  // reflect the lead funnel, not the Deals pipeline.
  const [wonLeadsResult] = wonLeadStageIds.length > 0
    ? await db.select({ count: count() }).from(leadsTable)
        .where(and(baseWhere, inArray(leadsTable.stageId, wonLeadStageIds)))
    : [{ count: 0 }];

  const [lostLeadsResult] = lostLeadStageIds.length > 0
    ? await db.select({ count: count() }).from(leadsTable)
        .where(and(baseWhere, inArray(leadsTable.stageId, lostLeadStageIds)))
    : [{ count: 0 }];

  const wonLeads = wonLeadsResult?.count ?? 0;
  const lostLeads = lostLeadsResult?.count ?? 0;
  // Conversion = Won Leads ÷ Total Leads (all leads in date/owner scope)
  const conversionRate = total > 0 ? Math.round((wonLeads / total) * 100 * 10) / 10 : 0;

  // ── Deal-based Avg Deal Size ───────────────────────────────────────────────
  // Avg deal size uses closed (won) Deal values — the Revenue Log is the
  // source of truth for actual deal value, not the lead's estimated dealValue.
  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
  const dealConditions: any[] = [wsFilter(dealsTable.workspaceId, wid) as any];
  if (ownerIdOverride !== undefined) {
    const isAllowed = allowedOwnerIds === null || allowedOwnerIds.includes(ownerIdOverride);
    if (isAllowed) {
      dealConditions.push(eq(dealsTable.ownerId, ownerIdOverride) as any);
    } else {
      const ids = allowedOwnerIds?.length ? allowedOwnerIds : [req.user.id];
      dealConditions.push(inArray(dealsTable.ownerId, ids) as any);
    }
  } else if (allowedOwnerIds !== null) {
    const ids = allowedOwnerIds.length === 0 ? [req.user.id] : allowedOwnerIds;
    dealConditions.push(inArray(dealsTable.ownerId, ids) as any);
  }
  const dealBaseWhere = and(...(dealConditions as any[]));

  const [wonDealsResult] = wonDealStageIds.length > 0
    ? await db.select({ avgValue: sql<string>`avg(${dealsTable.value})` })
        .from(dealsTable).where(and(dealBaseWhere, inArray(dealsTable.stageId, wonDealStageIds)))
    : [{ avgValue: null as string | null }];

  const avgDealSize = wonDealsResult?.avgValue
    ? Math.round(parseFloat(wonDealsResult.avgValue) * 100) / 100
    : null;

  // Avg sales cycle: mean days from creation to close for won deals (Deal-based)
  let avgSalesCycleDays: number | null = null;
  if (wonDealStageIds.length > 0) {
    const [cycleResult] = await db.select({
      avgDays: sql<string>`avg(extract(epoch from (updated_at - created_at))/86400)`
    }).from(dealsTable).where(and(dealBaseWhere, inArray(dealsTable.stageId, wonDealStageIds)));
    if (cycleResult?.avgDays) {
      avgSalesCycleDays = Math.round(parseFloat(cycleResult.avgDays));
    }
  }

  res.json({
    totalLeads: total,
    newLeads: newResult?.count ?? 0,
    followupsDue: dueCount,
    wonLeads,
    lostLeads,
    conversionRate,
    activeLeads: activeLeadsCount,
    avgDealSize,
    avgSalesCycleDays,
  });
});

router.get("/dashboard/pipeline", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const from = parseLeadRangeStart(req.query.from);
  const to = parseLeadRangeEndExclusive(req.query.to);
  const ownerIdOverride = parseOwnerIdParam(req.query.ownerId, req.user.role);
  const conditions = await buildLeadConditions(req.user, from, to, ownerIdOverride);

  const wid = req.user.workspaceId ?? null;
  const stages = await db.select().from(stagesTable).where(wsFilter(stagesTable.workspaceId, wid)).orderBy(stagesTable.order);
  const pipeline = await Promise.all(stages.map(async (stage) => {
    const stageConditions = [...conditions, eq(leadsTable.stageId, stage.id) as any];
    const [result] = await db.select({ count: count() }).from(leadsTable)
      .where(and(...(stageConditions as any[])));
    return {
      stageId: stage.id,
      stageName: stage.name,
      stageColor: stage.color,
      count: result?.count ?? 0,
    };
  }));

  res.json(pipeline);
});

router.get("/dashboard/conversion-funnel", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const from = parseLeadRangeStart(req.query.from);
  const to = parseLeadRangeEndExclusive(req.query.to);
  const ownerIdOverride = parseOwnerIdParam(req.query.ownerId, req.user.role);
  const conditions = await buildLeadConditions(req.user, from, to, ownerIdOverride);
  const baseWhere = conditions.length > 0 ? and(...(conditions as any[])) : undefined;

  const wid = req.user.workspaceId ?? null;
  // Only lead stages in the funnel — deal stages (global, wsId=null) must not appear here
  const stages = await db.select().from(stagesTable)
    .where(and(wsFilter(stagesTable.workspaceId, wid), eq(stagesTable.type, "lead")))
    .orderBy(stagesTable.order);
  const [totalResult] = await db.select({ count: count() }).from(leadsTable).where(baseWhere);
  const total = totalResult?.count ?? 1;

  const funnel = await Promise.all(stages.map(async (stage) => {
    const stageConditions = [...conditions, eq(leadsTable.stageId, stage.id) as any];
    const [result] = await db.select({ count: count() }).from(leadsTable)
      .where(and(...(stageConditions as any[])));
    const cnt = result?.count ?? 0;
    return { stage: stage.name, stageId: stage.id, count: cnt, percentage: Math.round((cnt / total) * 100 * 10) / 10 };
  }));

  res.json(funnel);
});

router.get("/dashboard/leaderboard", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const from = parseLeadRangeStart(req.query.from);
  const to = parseLeadRangeEndExclusive(req.query.to);

  const wid = req.user.workspaceId ?? null;
  // Deal stages (always global, workspaceId=null) — deals won/lost metric
  const dealStagesLB = await db.select().from(stagesTable)
    .where(and(isNull(stagesTable.workspaceId), eq(stagesTable.type, "deal")));
  const wonStageIds  = dealStagesLB.filter(s => s.isWon).map(s => s.id);
  const lostStageIds = dealStagesLB.filter(s => s.isLost).map(s => s.id);

  // Lead stages (workspace-scoped) — for per-user lead wins count alongside deal wins
  const leadStagesLB = await db.select().from(stagesTable)
    .where(and(wsFilter(stagesTable.workspaceId, wid), eq(stagesTable.type, "lead")));
  const wonLeadStageIds = leadStagesLB.filter(s => s.isWon).map(s => s.id);

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let users = await db.select().from(usersTable).where(wsFilter(usersTable.workspaceId, wid));
  if (allowedOwnerIds !== null) {
    const ids = allowedOwnerIds.length === 0 ? [req.user.id] : allowedOwnerIds;
    users = users.filter(u => ids.includes(u.numId));
  }

  const dateConditions: any[] = [];
  if (from) dateConditions.push(gte(leadClassificationDateSql, from));
  if (to) dateConditions.push(lt(leadClassificationDateSql, to));

  const result = await Promise.all(users.map(async (user) => {
    // ── Lead count + lead wins (Leads table, workspace-scoped lead stages) ──
    const leadCond: any[] = [
      eq(leadsTable.ownerId, user.numId),
      wsFilter(leadsTable.workspaceId, wid) as any,
      ...dateConditions,
    ];
    const [totalR] = await db.select({ count: count() }).from(leadsTable).where(and(...leadCond));

    // Per-user lead wins (leads owned by user that are in a won lead stage)
    const [wonLeadR] = wonLeadStageIds.length > 0
      ? await db.select({ count: count() }).from(leadsTable)
          .where(and(...leadCond, inArray(leadsTable.stageId, wonLeadStageIds)))
      : [{ count: 0 }];

    // ── Deal wins / losses → Deals table, ranked primary metric ──
    const dealCond: any[] = [
      eq(dealsTable.ownerId, user.numId),
      wsFilter(dealsTable.workspaceId, wid) as any,
    ];
    const [wonR] = wonStageIds.length > 0
      ? await db.select({ count: count() }).from(dealsTable)
          .where(and(...dealCond, inArray(dealsTable.stageId, wonStageIds)))
      : [{ count: 0 }];
    const [lostR] = lostStageIds.length > 0
      ? await db.select({ count: count() }).from(dealsTable)
          .where(and(...dealCond, inArray(dealsTable.stageId, lostStageIds)))
      : [{ count: 0 }];
    const [allDealsR] = await db.select({ count: count() }).from(dealsTable).where(and(...dealCond));

    const totalLeads     = totalR?.count ?? 0;
    const wonLeadsCount  = wonLeadR?.count ?? 0;
    const won            = wonR?.count ?? 0;
    const lost           = lostR?.count ?? 0;
    const totalDeals     = allDealsR?.count ?? 0;
    const activeDeals    = totalDeals - won - lost;

    // Deal win rate = Won Deals ÷ Total Deals owned by this user
    const conversionRate    = totalDeals > 0 ? Math.round((won / totalDeals) * 100 * 10) / 10 : 0;
    // Lead win rate = Won Leads ÷ Total Leads owned by this user
    const leadConversionRate = totalLeads > 0 ? Math.round((wonLeadsCount / totalLeads) * 100 * 10) / 10 : 0;

    return {
      userId: user.numId,
      userName: (`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email?.split("@")[0]) ?? `User ${user.numId}`,
      userAvatar: user.profileImageUrl ?? null,
      totalLeads,
      wonLeads: won,          // deal wins — primary ranking metric
      wonLeadsCount,          // lead wins — secondary stat shown alongside
      lostLeads: lost,
      activeLeads: activeDeals,
      conversionRate,         // deal win rate (won ÷ total deals)
      leadConversionRate,     // lead win rate (won leads ÷ total leads)
      pipelineValue: null,
    };
  }));

  // Rank by deal wins (revenue-generating), then deal win rate, then alphabetical
  res.json(result.sort((a, b) =>
    b.wonLeads - a.wonLeads ||
    Number(b.conversionRate) - Number(a.conversionRate) ||
    a.userName.localeCompare(b.userName)
  ));
});

router.get("/dashboard/data-health", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const from = parseLeadRangeStart(req.query.from);
  const to = parseLeadRangeEndExclusive(req.query.to);
  const conditions = await buildLeadConditions(req.user, from, to);
  const baseWhere = conditions.length > 0 ? and(...(conditions as any[])) : undefined;

  const [totalR] = await db.select({ count: count() }).from(leadsTable).where(baseWhere);
  const total = totalR?.count ?? 0;

  const unassignedConds = [...conditions, isNull(leadsTable.ownerId) as any];
  const [unassignedR] = await db.select({ count: count() }).from(leadsTable)
    .where(unassignedConds.length > 0 ? and(...(unassignedConds as any[])) : undefined);

  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const staleConds = [...conditions, lte(leadsTable.updatedAt, thirtyDaysAgo) as any];
  const [staleR] = await db.select({ count: count() }).from(leadsTable)
    .where(staleConds.length > 0 ? and(...(staleConds as any[])) : undefined);

  const missingEmailConds = [...conditions, isNull(leadsTable.email) as any];
  const [missingEmailR] = await db.select({ count: count() }).from(leadsTable)
    .where(missingEmailConds.length > 0 ? and(...(missingEmailConds as any[])) : undefined);

  const missingValueConds = [...conditions, isNull(leadsTable.valueAmount) as any];
  const [missingValueR] = await db.select({ count: count() }).from(leadsTable)
    .where(missingValueConds.length > 0 ? and(...(missingValueConds as any[])) : undefined);

  res.json({
    total,
    unassigned: unassignedR?.count ?? 0,
    stale: staleR?.count ?? 0,
    missingEmail: missingEmailR?.count ?? 0,
    missingValue: missingValueR?.count ?? 0,
  });
});

router.get("/dashboard/follow-ups-due", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const from = parseLeadRangeStart(req.query.from);
  const to = parseLeadRangeEndExclusive(req.query.to);
  const ownerIdOverride = parseOwnerIdParam(req.query.ownerId, req.user.role);
  const now = new Date();
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  const fuWid = req.user.workspaceId ?? null;
  let scopedLeadIds: number[] | null = null;
  if (ownerIdOverride !== undefined) {
    const isAllowed = allowedOwnerIds === null || allowedOwnerIds.includes(ownerIdOverride);
    if (isAllowed) {
      const rows = await db.select({ id: leadsTable.id }).from(leadsTable)
        .where(and(eq(leadsTable.ownerId, ownerIdOverride), wsFilter(leadsTable.workspaceId, fuWid)));
      scopedLeadIds = rows.map(r => r.id);
    } else if (allowedOwnerIds !== null) {
      const ids = allowedOwnerIds.length > 0 ? allowedOwnerIds : [req.user.id];
      const rows = await db.select({ id: leadsTable.id }).from(leadsTable)
        .where(and(inArray(leadsTable.ownerId, ids), wsFilter(leadsTable.workspaceId, fuWid)));
      scopedLeadIds = rows.map(r => r.id);
    }
  } else if (allowedOwnerIds !== null) {
    const ids = allowedOwnerIds.length === 0 ? [req.user.id] : allowedOwnerIds;
    const rows = await db.select({ id: leadsTable.id }).from(leadsTable)
      .where(and(inArray(leadsTable.ownerId, ids), wsFilter(leadsTable.workspaceId, fuWid)));
    scopedLeadIds = rows.map(r => r.id);
  }

  const scheduledFrom = from ?? now;
  const scheduledTo = to ?? weekEnd;

  const followupTimeCond = and(
    gte(followupsTable.scheduledAt, scheduledFrom),
    lte(followupsTable.scheduledAt, scheduledTo),
  );

  let baseFollowupWhere;
  if (scopedLeadIds !== null) {
    if (scopedLeadIds.length === 0) {
      res.json({ overdue: 0, dueToday: 0, dueThisWeek: 0, items: [] });
      return;
    }
    baseFollowupWhere = and(
      eq(followupsTable.status, "pending"),
      lte(followupsTable.scheduledAt, scheduledTo),
      inArray(followupsTable.leadId, scopedLeadIds),
    );
  } else {
    baseFollowupWhere = and(
      eq(followupsTable.status, "pending"),
      lte(followupsTable.scheduledAt, scheduledTo),
      wsFilter(followupsTable.workspaceId, fuWid),
    );
  }

  const followups = await db
    .select({
      id: followupsTable.id,
      leadId: followupsTable.leadId,
      scheduledAt: followupsTable.scheduledAt,
      notes: followupsTable.notes,
      status: followupsTable.status,
      companyName: leadsTable.companyName,
      contactPerson: leadsTable.contactPerson,
    })
    .from(followupsTable)
    .innerJoin(leadsTable, eq(followupsTable.leadId, leadsTable.id))
    .where(baseFollowupWhere)
    .orderBy(desc(followupsTable.scheduledAt), desc(followupsTable.id));

  const filtered = activeFollowups(followups, from);

  // Count distinct leads (not follow-up rows) so a lead with multiple overdue
  // follow-ups doesn't inflate the number shown on the widget — the click-through
  // to the Leads page deduplicates by lead, so the counts must match.
  const dueThisWeekEnd = to ? new Date(Math.min(weekEnd.getTime(), scheduledTo.getTime())) : weekEnd;
  const { overdue, dueToday, dueThisWeek } = followupDueCounts(filtered, now, todayEnd, dueThisWeekEnd);

  res.json({
    overdue,
    dueToday,
    dueThisWeek,
    items: newestFollowupsFirst(filtered).map(f => ({
      id: f.id,
      leadId: f.leadId,
      leadCompanyName: f.companyName,
      contactPerson: f.contactPerson ?? null,
      scheduledAt: f.scheduledAt.toISOString(),
      notes: f.notes ?? null,
      status: f.status,
    })),
  });
});

router.get("/dashboard/my-day", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayStart.getDate() + 1);

  const dow = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  const mydayWid = req.user.workspaceId ?? null;
  let all = await db.select().from(scheduledActivitiesTable)
    .where(wsFilter(scheduledActivitiesTable.workspaceId, mydayWid));

  if (allowedOwnerIds !== null) {
    if (allowedOwnerIds.length === 0) {
      all = all.filter(a => a.ownerId === req.user.id);
    } else {
      all = all.filter(a => a.ownerId !== null && allowedOwnerIds.includes(a.ownerId));
    }
  }

  const today = all.filter(a => a.dueAt >= todayStart && a.dueAt < todayEnd);
  const week = all.filter(a => a.dueAt >= weekStart && a.dueAt < weekEnd);

  res.json({
    todayTotal: today.length,
    todayCompleted: today.filter(a => a.status === "completed").length,
    todayOverdue: today.filter(a => a.status === "overdue" || (a.status === "open" && a.dueAt < now)).length,
    weekTotal: week.length,
    weekCompleted: week.filter(a => a.status === "completed").length,
  });
});

// ── GET /dashboard/deals-by-stage ────────────────────────────────────────────
// Returns counts per deal stage (Ongoing / Closed / Dropped) — always global stages.
router.get("/dashboard/deals-by-stage", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;

  const dealStages = await db.select().from(stagesTable)
    .where(and(isNull(stagesTable.workspaceId), eq(stagesTable.type, "deal")))
    .orderBy(stagesTable.order);

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
  const dealConds: any[] = [wsFilter(dealsTable.workspaceId, wid) as any];
  if (allowedOwnerIds !== null) {
    const ids = allowedOwnerIds.length === 0 ? [req.user.id] : allowedOwnerIds;
    dealConds.push(inArray(dealsTable.ownerId, ids) as any);
  }

  const result = await Promise.all(dealStages.map(async (stage) => {
    const conds = [...dealConds, eq(dealsTable.stageId, stage.id) as any];
    const [r] = await db.select({ count: count() }).from(dealsTable).where(and(...(conds as any[])));
    return {
      stageId: stage.id,
      stageName: stage.name,
      stageColor: stage.color ?? null,
      isWon: stage.isWon,
      isLost: stage.isLost,
      count: r?.count ?? 0,
    };
  }));

  res.json(result);
});

// ── GET /dashboard/revenue-over-time ─────────────────────────────────────────
// Monthly + cumulative revenue from deal_revenue_entries across all scoped deals.
// Negative entries (losses) are included; cumulative can dip if a month nets negative.
router.get("/dashboard/revenue-over-time", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);
  const dealConds: any[] = [wsFilter(dealsTable.workspaceId, wid) as any];
  if (allowedOwnerIds !== null) {
    const ids = allowedOwnerIds.length === 0 ? [req.user.id] : allowedOwnerIds;
    dealConds.push(inArray(dealsTable.ownerId, ids) as any);
  }

  const rows = await db
    .select({
      month: dealRevenueEntriesTable.month,
      total: sql<string>`sum(${dealRevenueEntriesTable.amount}::numeric)`,
    })
    .from(dealRevenueEntriesTable)
    .innerJoin(dealsTable, eq(dealRevenueEntriesTable.dealId, dealsTable.id))
    .where(and(...(dealConds as any[])))
    .groupBy(dealRevenueEntriesTable.month)
    .orderBy(asc(dealRevenueEntriesTable.month));

  let cumulative = 0;
  const data = rows.map(r => {
    const total = parseFloat(r.total ?? "0");
    cumulative += total;
    return {
      month: r.month.slice(0, 7),
      total: Math.round(total * 100) / 100,
      cumulative: Math.round(cumulative * 100) / 100,
    };
  });

  res.json(data);
});

export default router;
