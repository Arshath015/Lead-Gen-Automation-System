import { Router, type IRouter, type Request, type Response } from "express";
import { db, automationRulesTable, followupsTable, notificationsTable, leadsTable, teamMembersTable, auditLogsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

router.get("/automation/rules", requirePermission("automation.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const wid = req.user.workspaceId ?? null;
  const rules = await db.select().from(automationRulesTable)
    .where(wsFilter(automationRulesTable.workspaceId, wid))
    .orderBy(desc(automationRulesTable.createdAt));
  res.json(rules.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

router.post("/automation/rules", requirePermission("automation.create"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, trigger, triggerValue, actionType, actionValue, isActive } = req.body;
  if (!name?.trim() || !trigger || !actionType) { res.status(400).json({ error: "name, trigger, and actionType are required" }); return; }
  const wid = req.user.workspaceId ?? null;

  const [rule] = await db.insert(automationRulesTable).values({
    name: name.trim(),
    trigger,
    triggerValue: triggerValue ?? null,
    actionType,
    actionValue: actionValue ?? null,
    isActive: isActive !== false,
    createdById: req.user.id,
    workspaceId: wid,
  }).returning();

  res.status(201).json({ ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() });
});

router.patch("/automation/rules/:id", requirePermission("automation.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(automationRulesTable)
    .where(and(eq(automationRulesTable.id, id), wsFilter(automationRulesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const { name, trigger, triggerValue, actionType, actionValue, isActive } = req.body;
  const updates: Partial<typeof automationRulesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (trigger !== undefined) updates.trigger = trigger;
  if (triggerValue !== undefined) updates.triggerValue = triggerValue;
  if (actionType !== undefined) updates.actionType = actionType;
  if (actionValue !== undefined) updates.actionValue = actionValue;
  if (isActive !== undefined) updates.isActive = isActive;

  const [rule] = await db.update(automationRulesTable).set(updates).where(eq(automationRulesTable.id, id)).returning();
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() });
});

router.delete("/automation/rules/:id", requirePermission("automation.delete"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  const wid = req.user.workspaceId ?? null;

  const [existing] = await db.select().from(automationRulesTable)
    .where(and(eq(automationRulesTable.id, id), wsFilter(automationRulesTable.workspaceId, wid)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(automationRulesTable).where(eq(automationRulesTable.id, id));
  res.status(204).send();
});

// ── Round-robin state (in-memory, resets on restart) ─────────────────────────
const roundRobinCursor: Map<number, number> = new Map();

/**
 * Evaluate automation rules for a given trigger event.
 * workspaceId scopes the rules to the current workspace — rules from other
 * workspaces are never evaluated.
 *
 * SECURITY: workspaceId must come from the authenticated session, never from
 * client input.
 */
export async function evaluateAutomationRules(
  trigger: string,
  triggerValue: string | null,
  leadId: number | null,
  userId: number | null,
  workspaceId: number | null = null,
) {
  try {
    const rules = await db.select().from(automationRulesTable)
      .where(and(
        eq(automationRulesTable.isActive, true),
        wsFilter(automationRulesTable.workspaceId, workspaceId),
      ));

    const [lead] = leadId ? await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)) : [null];

    const matching = rules.filter(r => {
      if (r.trigger !== trigger) return false;

      if (r.trigger === "field_value" && r.triggerValue) {
        if (!lead) return false;
        const colonIdx = r.triggerValue.indexOf(":");
        if (colonIdx === -1) return false;
        const fieldName = r.triggerValue.slice(0, colonIdx).trim();
        const expected = r.triggerValue.slice(colonIdx + 1).trim().toLowerCase();
        const actual = String((lead as Record<string, unknown>)[fieldName] ?? "").toLowerCase();
        return actual === expected;
      }

      if (r.triggerValue && r.triggerValue !== triggerValue) return false;
      return true;
    });

    for (const rule of matching) {
      if (!leadId) continue;

      if (rule.actionType === "create_followup") {
        const dueAt = new Date();
        dueAt.setDate(dueAt.getDate() + 1);
        const [followup] = await db.insert(followupsTable).values({
          leadId,
          scheduledAt: dueAt,
          notes: rule.actionValue ?? `Auto follow-up from rule: ${rule.name}`,
          status: "pending",
          createdById: userId,
          workspaceId,
        }).returning();

        await db.update(leadsTable)
          .set({ nextFollowUpAt: followup.scheduledAt })
          .where(eq(leadsTable.id, leadId));

      } else if (rule.actionType === "send_notification") {
        if (lead?.ownerId) {
          await db.insert(notificationsTable).values({
            userId: lead.ownerId,
            type: "lead_assigned",
            title: `Automation: ${rule.name}`,
            body: rule.actionValue ?? `Triggered by ${trigger}`,
            leadId,
            workspaceId,
          }).catch(() => {});
        }
      } else if (rule.actionType === "auto_assign") {
        const teamId = rule.actionValue ? Number(rule.actionValue) : null;

        let candidateIds: number[];
        if (teamId && !isNaN(teamId)) {
          const members = await db.select({ userId: teamMembersTable.userId })
            .from(teamMembersTable)
            .where(eq(teamMembersTable.teamId, teamId));
          candidateIds = members.map(m => m.userId);
        } else {
          const members = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable);
          candidateIds = [...new Set(members.map(m => m.userId))];
        }

        if (candidateIds.length > 0) {
          candidateIds.sort((a, b) => a - b);
          const prev = roundRobinCursor.get(rule.id) ?? -1;
          const nextIdx = (prev + 1) % candidateIds.length;
          roundRobinCursor.set(rule.id, nextIdx);
          const assigneeId = candidateIds[nextIdx];

          await db.update(leadsTable).set({ ownerId: assigneeId }).where(eq(leadsTable.id, leadId)).catch(() => {});

          await db.insert(notificationsTable).values({
            userId: assigneeId,
            type: "lead_assigned",
            title: `Lead auto-assigned: ${lead?.companyName ?? "New lead"}`,
            body: `Automation rule "${rule.name}" assigned this lead to you.`,
            leadId,
            workspaceId,
          }).catch(() => {});
        }
      }

      await db.insert(auditLogsTable).values({
        leadId,
        userId,
        action: "automation",
        tableName: "automation_rules",
        fieldName: rule.name,
        oldValue: rule.trigger + (rule.triggerValue ? `:${rule.triggerValue}` : ""),
        newValue: rule.actionType + (rule.actionValue ? `:${rule.actionValue}` : ""),
        ipAddress: null,
        workspaceId,
      }).catch(() => {});
    }
  } catch {
    // Automation failures must never block the main request
  }
}

export default router;
