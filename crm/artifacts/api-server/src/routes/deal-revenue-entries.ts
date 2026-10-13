import { Router, type IRouter, type Request, type Response } from "express";
import { db, dealsTable, dealRevenueEntriesTable, usersTable } from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { z } from "zod";

const router: IRouter = Router();

/** Recompute and cache deals.value as the sum of all revenue entries for that deal */
async function syncDealValue(dealId: number): Promise<void> {
  await db
    .update(dealsTable)
    .set({
      value: sql`(
        SELECT COALESCE(SUM(amount), 0)
        FROM deal_revenue_entries
        WHERE deal_id = ${dealId}
      )`,
      updatedAt: new Date(),
    })
    .where(eq(dealsTable.id, dealId));
}

const validNumber = z.string().min(1).refine(
  s => !isNaN(Number(s)) && isFinite(Number(s)),
  { message: "amount must be a valid number (use a negative value to record a loss)" }
);

const EntryInputSchema = z.object({
  amount: validNumber,
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "month must be YYYY-MM-DD"),
  note: z.string().optional(),
});

const EntryUpdateSchema = z.object({
  amount: validNumber.optional(),
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "month must be YYYY-MM-DD").optional(),
  note: z.string().nullable().optional(),
});

function toDto(row: typeof dealRevenueEntriesTable.$inferSelect & { createdByName?: string | null }) {
  return {
    id: row.id,
    dealId: row.dealId,
    amount: row.amount?.toString() ?? "0",
    month: row.month,
    note: row.note ?? null,
    createdById: row.createdById ?? null,
    createdByName: (row as any).createdByName ?? null,
    workspaceId: row.workspaceId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /deals/:dealId/revenue-entries ───────────────────────────────────────
router.get(
  "/deals/:dealId/revenue-entries",
  requirePermission("deals.view"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
    const dealId = Number(req.params.dealId);
    if (!dealId) { res.status(400).json({ error: "Invalid dealId" }); return; }
    const wid = req.user!.workspaceId ?? null;

    // Verify deal belongs to this workspace
    const [deal] = await db.select({ id: dealsTable.id })
      .from(dealsTable)
      .where(and(eq(dealsTable.id, dealId), wsFilter(dealsTable.workspaceId, wid)));
    if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

    const rows = await db
      .select({
        entry: dealRevenueEntriesTable,
        createdByFirstName: usersTable.firstName,
        createdByLastName: usersTable.lastName,
        createdByEmail: usersTable.email,
      })
      .from(dealRevenueEntriesTable)
      .leftJoin(usersTable, eq(dealRevenueEntriesTable.createdById, usersTable.numId))
      .where(eq(dealRevenueEntriesTable.dealId, dealId))
      .orderBy(asc(dealRevenueEntriesTable.month), asc(dealRevenueEntriesTable.createdAt));

    res.json(rows.map(r => toDto({
      ...r.entry,
      createdByName: r.createdByFirstName
        ? `${r.createdByFirstName} ${r.createdByLastName ?? ""}`.trim()
        : (r.createdByEmail?.split("@")[0] ?? null),
    })));
  }
);

// ── POST /deals/:dealId/revenue-entries ──────────────────────────────────────
router.post(
  "/deals/:dealId/revenue-entries",
  requirePermission("revenue_entries.manage"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
    const dealId = Number(req.params.dealId);
    if (!dealId) { res.status(400).json({ error: "Invalid dealId" }); return; }
    const wid = req.user!.workspaceId ?? null;

    const parsed = EntryInputSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }

    // Verify deal belongs to this workspace
    const [deal] = await db.select({ id: dealsTable.id })
      .from(dealsTable)
      .where(and(eq(dealsTable.id, dealId), wsFilter(dealsTable.workspaceId, wid)));
    if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

    const [created] = await db
      .insert(dealRevenueEntriesTable)
      .values({
        dealId,
        amount: parsed.data.amount,
        month: parsed.data.month,
        note: parsed.data.note ?? null,
        createdById: req.user!.id,
        workspaceId: wid,
      })
      .returning();

    await syncDealValue(dealId);

    res.status(201).json(toDto(created));
  }
);

// ── PATCH /deals/:dealId/revenue-entries/:entryId ────────────────────────────
router.patch(
  "/deals/:dealId/revenue-entries/:entryId",
  requirePermission("revenue_entries.manage"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
    const dealId = Number(req.params.dealId);
    const entryId = Number(req.params.entryId);
    if (!dealId || !entryId) { res.status(400).json({ error: "Invalid IDs" }); return; }
    const wid = req.user!.workspaceId ?? null;

    const parsed = EntryUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }

    // Verify entry belongs to this deal and workspace
    const [existing] = await db
      .select({ id: dealRevenueEntriesTable.id })
      .from(dealRevenueEntriesTable)
      .innerJoin(dealsTable, eq(dealRevenueEntriesTable.dealId, dealsTable.id))
      .where(
        and(
          eq(dealRevenueEntriesTable.id, entryId),
          eq(dealRevenueEntriesTable.dealId, dealId),
          wsFilter(dealsTable.workspaceId, wid)
        )
      );
    if (!existing) { res.status(404).json({ error: "Entry not found" }); return; }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.amount !== undefined) updates.amount = parsed.data.amount;
    if (parsed.data.month !== undefined) updates.month = parsed.data.month;
    if ("note" in parsed.data) updates.note = parsed.data.note ?? null;

    const [updated] = await db
      .update(dealRevenueEntriesTable)
      .set(updates)
      .where(eq(dealRevenueEntriesTable.id, entryId))
      .returning();

    await syncDealValue(dealId);

    res.json(toDto(updated));
  }
);

// ── DELETE /deals/:dealId/revenue-entries/:entryId ───────────────────────────
router.delete(
  "/deals/:dealId/revenue-entries/:entryId",
  requirePermission("revenue_entries.manage"),
  async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
    const dealId = Number(req.params.dealId);
    const entryId = Number(req.params.entryId);
    if (!dealId || !entryId) { res.status(400).json({ error: "Invalid IDs" }); return; }
    const wid = req.user!.workspaceId ?? null;

    const [existing] = await db
      .select({ id: dealRevenueEntriesTable.id })
      .from(dealRevenueEntriesTable)
      .innerJoin(dealsTable, eq(dealRevenueEntriesTable.dealId, dealsTable.id))
      .where(
        and(
          eq(dealRevenueEntriesTable.id, entryId),
          eq(dealRevenueEntriesTable.dealId, dealId),
          wsFilter(dealsTable.workspaceId, wid)
        )
      );
    if (!existing) { res.status(404).json({ error: "Entry not found" }); return; }

    await db.delete(dealRevenueEntriesTable).where(eq(dealRevenueEntriesTable.id, entryId));
    await syncDealValue(dealId);

    res.status(204).send();
  }
);

export default router;
