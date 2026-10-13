import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, stagesTable, usersTable } from "@workspace/db";
import { eq, count, sql, gte, lte, and, inArray, or } from "drizzle-orm";
import { requirePermission } from "../lib/permissions";
import {
  GetMonthlyGrowthQueryParams,
} from "@workspace/api-zod";
import { getAllowedOwnerIds, type ScopeUser } from "../lib/scope";
import { wsFilter } from "../lib/workspaceScope";
import { leadClassificationDateSql } from "../lib/lead-classification";
import { chronologicalMonths } from "../lib/dashboard-ordering";

const router: IRouter = Router();

function parseDateParam(val: unknown): Date | undefined {
  if (typeof val !== "string" || !val) return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

// ── City normalisation (for leads-by-location) ────────────────────────────────
export const CITY_SYNONYMS: Record<string, string> = {
  "gurugram": "Gurgaon",         "gurgaon": "Gurgaon",
  "new delhi": "Delhi",          "delhi": "Delhi",
  "bengaluru": "Bangalore",      "bangalore": "Bangalore",
  "bombay": "Mumbai",            "mumbai": "Mumbai",         "navi mumbai": "Mumbai", "thane": "Mumbai",
  "calcutta": "Kolkata",         "kolkata": "Kolkata",
  "madras": "Chennai",           "chennai": "Chennai",       "coimbatore": "Coimbatore", "madurai": "Madurai",
  "secunderabad": "Hyderabad",   "hyderabad": "Hyderabad",   "visakhapatnam": "Visakhapatnam", "vizag": "Visakhapatnam",
  "pune": "Pune",                "pimpri": "Pune",           "chinchwad": "Pune",
  "ahmedabad": "Ahmedabad",      "amdavad": "Ahmedabad",     "surat": "Surat", "vadodara": "Vadodara", "baroda": "Vadodara",
  "noida": "Noida",              "greater noida": "Noida",   "ghaziabad": "Ghaziabad", "faridabad": "Faridabad",
  "chandigarh": "Chandigarh",    "mohali": "Chandigarh",
  "jaipur": "Jaipur",            "jodhpur": "Jodhpur",       "udaipur": "Udaipur",     "kota": "Kota",
  "lucknow": "Lucknow",          "kanpur": "Kanpur",         "agra": "Agra",           "varanasi": "Varanasi",
  "meerut": "Meerut",            "allahabad": "Prayagraj",   "prayagraj": "Prayagraj",
  "nagpur": "Nagpur",            "nashik": "Nashik",         "aurangabad": "Aurangabad", "solapur": "Solapur",
  "indore": "Indore",            "bhopal": "Bhopal",         "raipur": "Raipur",
  "kochi": "Kochi",              "cochin": "Kochi",          "thiruvananthapuram": "Thiruvananthapuram", "trivandrum": "Thiruvananthapuram",
  "patna": "Patna",              "ranchi": "Ranchi",         "bhubaneswar": "Bhubaneswar",
  "ludhiana": "Ludhiana",        "amritsar": "Amritsar",     "jalandhar": "Jalandhar",
};

const INDIAN_STATES_SET = new Set([
  "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa",
  "gujarat", "haryana", "himachal pradesh", "jharkhand", "karnataka", "kerala",
  "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland",
  "odisha", "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana",
  "tripura", "uttar pradesh", "uttarakhand", "west bengal", "delhi",
  "jammu and kashmir", "ladakh", "puducherry", "pondicherry", "nct",
]);

const PIN_RE   = /\b\d{6}\b/;
const SECTOR_RE = /^sector[-\s]?\d+[a-z]?$/i;
const ADDR_WORDS = /floor|building|plot|block|tower|wing|office|road|street|avenue|marg|nagar|colony|phase|village|cyber|dlf|techno|park|hub|complex|industrial|estate|district/i;

function normalizeCity(raw: string): string {
  const trimmed = raw.trim();

  // Direct full-string match
  const directKey = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (CITY_SYNONYMS[directKey]) return CITY_SYNONYMS[directKey];

  // Split by comma/semicolon; strip trailing pin codes from each part
  const parts = trimmed
    .split(/[,;]/)
    .map(p => p.trim().replace(/\s*[-–]\s*\d{5,6}\s*$/, "").trim())
    .filter(p => p.length > 0);

  // Exact synonym match on each part
  for (const part of parts) {
    const key = part.toLowerCase().replace(/\s+/g, " ");
    if (CITY_SYNONYMS[key]) return CITY_SYNONYMS[key];
  }

  // Substring synonym match (catches "Gurugram" inside "DLF Cyber City, Gurugram")
  for (const part of parts) {
    const lower = part.toLowerCase();
    for (const [syn, city] of Object.entries(CITY_SYNONYMS)) {
      if (lower.includes(syn)) return city;
    }
  }

  // Fallback: first part that looks like a city name (not a pin, sector, state, or street address)
  for (const part of parts) {
    if (PIN_RE.test(part)) continue;
    if (SECTOR_RE.test(part)) continue;
    if (ADDR_WORDS.test(part)) continue;
    const lower = part.toLowerCase().replace(/\s+/g, " ");
    if (INDIAN_STATES_SET.has(lower)) continue;
    if (part.length < 2 || part.length > 40) continue;
    return part;
  }

  // Last resort: truncate original
  return trimmed.length > 25 ? trimmed.substring(0, 25) + "…" : trimmed;
}

/**
 * Given a location filter string (e.g. "Bangalore"), return every lowercase
 * synonym key that normalizeCity() would fold into the same canonical city.
 * Used by the leads list/export endpoints so clicking a chart bar for
 * "Bangalore" also matches raw "Bengaluru" entries (and vice-versa), keeping
 * the on-screen count and the CSV export count in sync with the chart.
 */
export function getCityVariants(filter: string): string[] {
  const key = filter.trim().toLowerCase().replace(/\s+/g, " ");
  // Resolve the canonical form (e.g. "Bangalore" → "Bangalore", "bengaluru" → "Bangalore")
  const canonical = (CITY_SYNONYMS[key] ?? filter.trim()).toLowerCase();
  // Collect every synonym that maps to the same canonical city
  const variants = Object.entries(CITY_SYNONYMS)
    .filter(([, v]) => v.toLowerCase() === canonical)
    .map(([k]) => k);
  // Also include the raw filter itself in case it's not in the synonym table
  if (!variants.includes(key)) variants.push(key);
  return variants;
}

const TOP_N = 10;

function applyTopNWithOther(rows: { name: string; count: number }[]): { name: string; count: number }[] {
  if (rows.length <= TOP_N) return rows;
  const top  = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  const otherTotal = rest.reduce((sum, r) => sum + r.count, 0);
  return [...top, { name: "Other", count: otherTotal }];
}

/**
 * Returns the lead IDs the caller may see, scoped to their workspace.
 * Returns null for admin (meaning no owner-ID filter, but workspace filter must still be applied separately).
 */
async function getScopedLeadIds(user: Express.User): Promise<number[] | null> {
  const allowedOwnerIds = await getAllowedOwnerIds(user as ScopeUser);
  const wid = user.workspaceId ?? null;

  if (allowedOwnerIds === null) {
    return null; // admin: no owner-scope restriction, but workspace filter applied per-route
  }

  // Include leads owned by OR created by the allowed users (fixes manager
  // visibility for self-created leads that were never explicitly assigned)
  const scopeCond = allowedOwnerIds.length === 0
    ? or(eq(leadsTable.ownerId, user.id), eq(leadsTable.createdById, user.id))
    : or(inArray(leadsTable.ownerId, allowedOwnerIds), inArray(leadsTable.createdById, allowedOwnerIds));
  const scopedLeads = await db.select({ id: leadsTable.id }).from(leadsTable)
    .where(and(scopeCond, wsFilter(leadsTable.workspaceId, wid)));
  return scopedLeads.map(l => l.id);
}

router.get("/reports/leads-by-status", requirePermission("reports.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;

  const scopedLeadIds = await getScopedLeadIds(req.user);
  const stages = await db.select().from(stagesTable).where(wsFilter(stagesTable.workspaceId, wid));
  const result = await Promise.all(stages.map(async (stage) => {
    const conditions: any[] = [eq(leadsTable.stageId, stage.id), wsFilter(leadsTable.workspaceId, wid) as any];
    if (scopedLeadIds !== null && scopedLeadIds.length > 0) {
      conditions.push(inArray(leadsTable.id, scopedLeadIds));
    } else if (scopedLeadIds !== null && scopedLeadIds.length === 0) {
      return { name: stage.name, count: 0, stageId: stage.id };
    }
    const [r] = await db.select({ count: count() }).from(leadsTable)
      .where(and(...conditions));
    return { name: stage.name, count: r?.count ?? 0, stageId: stage.id };
  }));
  res.json(result);
});

router.get("/reports/leads-by-industry", requirePermission("reports.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const raw = req.query.raw === "true"; // bypass all cleaning + cap for CSV export

  // Dashboard hooks send dateFrom/dateTo while report pages use from/to.
  // Both ranges classify a lead by its scheduled follow-up when present.
  const from = parseDateParam(req.query.from ?? req.query.dateFrom);
  const to   = parseDateParam(req.query.to ?? req.query.dateTo);
  const scopedLeadIds = await getScopedLeadIds(req.user);

  const conds: any[] = [wsFilter(leadsTable.workspaceId, wid) as any];
  if (scopedLeadIds !== null) {
    if (scopedLeadIds.length === 0) { res.json([]); return; }
    conds.push(inArray(leadsTable.id, scopedLeadIds));
  }
  if (from) conds.push(gte(leadClassificationDateSql, from));
  if (to)   conds.push(lte(leadClassificationDateSql, to));

  // Chart view: exclude values > 60 chars (they're notes/remarks that got mapped
  // into the industry field during CSV import — not real industry names)
  if (!raw) conds.push(sql`length(${leadsTable.industry}) <= 60`);

  const rows = await db.select({ industry: leadsTable.industry, count: count() })
    .from(leadsTable)
    .where(and(...conds))
    .groupBy(leadsTable.industry);

  const sorted = rows
    .filter(r => r.industry && r.industry.trim().length > 0)
    .map(r => ({ name: r.industry!.trim(), count: r.count }))
    .sort((a, b) => b.count - a.count);

  res.json(raw ? sorted : applyTopNWithOther(sorted));
});

router.get("/reports/leads-by-location", requirePermission("reports.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const raw = req.query.raw === "true"; // bypass normalisation + cap for CSV export

  const from = parseDateParam(req.query.from);
  const to   = parseDateParam(req.query.to);
  const scopedLeadIds = await getScopedLeadIds(req.user);

  const conds: any[] = [wsFilter(leadsTable.workspaceId, wid) as any];
  if (scopedLeadIds !== null) {
    if (scopedLeadIds.length === 0) { res.json([]); return; }
    conds.push(inArray(leadsTable.id, scopedLeadIds));
  }
  if (from) conds.push(gte(leadClassificationDateSql, from));
  if (to)   conds.push(lte(leadClassificationDateSql, to));

  const rows = await db.select({ location: leadsTable.location, count: count() })
    .from(leadsTable)
    .where(and(...conds))
    .groupBy(leadsTable.location);

  const withValues = rows.filter(r => r.location && r.location.trim().length > 0);

  if (raw) {
    // Raw export: return every unique raw location string, sorted by count
    res.json(
      withValues
        .map(r => ({ name: r.location!.trim(), count: r.count }))
        .sort((a, b) => b.count - a.count)
    );
    return;
  }

  // Chart view: normalise to city names, re-group, top-N + Other
  // Only use the normalised result as a named bucket when it resolves to a
  // known canonical city (i.e. a value present in CITY_SYNONYMS). Address
  // fragments that escape the normaliser — office building names, road
  // addresses, acronyms like "Rmz Azure" — are folded into "Other" so they
  // don't pollute the chart with non-city entries.
  const KNOWN_CANONICAL_CITIES = new Set(Object.values(CITY_SYNONYMS));
  const cityMap = new Map<string, number>();
  for (const r of withValues) {
    const city = normalizeCity(r.location!);
    const bucket = KNOWN_CANONICAL_CITIES.has(city) ? city : "Other";
    cityMap.set(bucket, (cityMap.get(bucket) ?? 0) + r.count);
  }

  const sorted = [...cityMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  res.json(applyTopNWithOther(sorted));
});

router.get("/reports/monthly-growth", requirePermission("reports.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const qp = GetMonthlyGrowthQueryParams.safeParse(req.query);
  const months = qp.success ? (qp.data.months ?? 12) : 12;

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const scopedLeadIds = await getScopedLeadIds(req.user);

  const conds: any[] = [wsFilter(leadsTable.workspaceId, wid) as any];
  if (scopedLeadIds !== null) {
    if (scopedLeadIds.length === 0) { res.json([]); return; }
    conds.push(inArray(leadsTable.id, scopedLeadIds));
  }
  if (from) conds.push(gte(leadClassificationDateSql, from));
  if (to) conds.push(lte(leadClassificationDateSql, to));

  const rows = await db.select({
    month: sql<string>`to_char(${leadClassificationDateSql}, 'Mon')`,
    year: sql<number>`extract(year from ${leadClassificationDateSql})::int`,
    monthNumber: sql<number>`extract(month from ${leadClassificationDateSql})::int`,
    count: count(),
  }).from(leadsTable)
    .where(and(...conds))
    .groupBy(
      sql`to_char(${leadClassificationDateSql}, 'Mon')`,
      sql`extract(year from ${leadClassificationDateSql})`,
      sql`extract(month from ${leadClassificationDateSql})`,
    )
    .orderBy(
      sql`extract(year from ${leadClassificationDateSql})`,
      sql`extract(month from ${leadClassificationDateSql})`,
    );

  const result = chronologicalMonths(rows).slice(-months).map(r => ({
    month: r.month,
    year: r.year,
    created: r.count,
    won: 0,
    lost: 0,
  }));
  res.json(result);
});

router.get("/reports/user-performance", requirePermission("reports.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role === "bd") { res.status(403).json({ error: "Forbidden" }); return; }
  const wid = req.user.workspaceId ?? null;

  const stages = await db.select().from(stagesTable).where(wsFilter(stagesTable.workspaceId, wid));
  const wonStageId = stages.find(s => s.isWon)?.id;
  const lostStageId = stages.find(s => s.isLost)?.id;

  const allowedOwnerIds = await getAllowedOwnerIds(req.user as ScopeUser);

  let users = await db.select().from(usersTable).where(wsFilter(usersTable.workspaceId, wid));
  if (allowedOwnerIds !== null && allowedOwnerIds.length > 0) {
    users = users.filter(u => allowedOwnerIds.includes(u.numId));
  }

  const result = await Promise.all(users.map(async (user) => {
    const baseCond: any[] = [eq(leadsTable.ownerId, user.numId), wsFilter(leadsTable.workspaceId, wid) as any];
    const [totalR] = await db.select({ count: count() }).from(leadsTable).where(and(...baseCond));
    const [wonR] = wonStageId
      ? await db.select({ count: count() }).from(leadsTable).where(and(eq(leadsTable.ownerId, user.numId), wsFilter(leadsTable.workspaceId, wid) as any, eq(leadsTable.stageId, wonStageId)))
      : [{ count: 0 }];
    const [lostR] = lostStageId
      ? await db.select({ count: count() }).from(leadsTable).where(and(eq(leadsTable.ownerId, user.numId), wsFilter(leadsTable.workspaceId, wid) as any, eq(leadsTable.stageId, lostStageId)))
      : [{ count: 0 }];
    const total = totalR?.count ?? 0;
    const won = wonR?.count ?? 0;
    const lost = lostR?.count ?? 0;
    return {
      userId: user.numId,
      userName: (`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email?.split("@")[0]) ?? `User ${user.numId}`,
      userAvatar: user.profileImageUrl ?? null,
      totalLeads: total,
      wonLeads: won,
      lostLeads: lost,
      activeLeads: total - won - lost,
      conversionRate: total > 0 ? Math.round((won / total) * 100 * 10) / 10 : 0,
    };
  }));

  res.json(result.filter(r => r.totalLeads > 0));
});

router.get("/reports/leads-by-source", requirePermission("reports.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const scopedLeadIds = await getScopedLeadIds(req.user);

  const conds: any[] = [wsFilter(leadsTable.workspaceId, wid) as any];
  if (scopedLeadIds !== null) {
    if (scopedLeadIds.length === 0) { res.json([]); return; }
    conds.push(inArray(leadsTable.id, scopedLeadIds));
  }
  if (from) conds.push(gte(leadClassificationDateSql, from));
  if (to) conds.push(lte(leadClassificationDateSql, to));

  const rows = await db.select({
    name: leadsTable.source,
    count: count(),
  })
    .from(leadsTable)
    .where(and(...conds))
    .groupBy(leadsTable.source)
    .orderBy(sql`count(*) desc`);

  res.json(rows.filter(r => r.name).map(r => ({ name: r.name!, count: r.count })));
});

export default router;
