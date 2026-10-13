/**
 * One-time-safe startup function that resyncs the Finance system role's
 * permissions and widget config for every existing workspace.
 *
 * Safe to run on every restart: it deletes and re-inserts, so repeated
 * runs are idempotent. Only touches the Finance role row.
 */
import { db, rolesTable, rolePermissionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getDefaultRolePermissions } from "@workspace/db";
import { logger } from "./logger";

export async function resyncFinanceRole(): Promise<void> {
  try {
    const { roleDashboardWidgetsTable } = await import("@workspace/db");

    // Find all Finance system role rows (one per workspace)
    const financeRoles = await db
      .select({ id: rolesTable.id, workspaceId: rolesTable.workspaceId })
      .from(rolesTable)
      .where(and(eq(rolesTable.name, "Finance"), eq(rolesTable.isSystem, true)));

    if (financeRoles.length === 0) {
      logger.info("resyncFinanceRole: no Finance roles found — skipping");
      return;
    }

    const perms = getDefaultRolePermissions("finance");

    for (const role of financeRoles) {
      // Resync permissions
      await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, role.id));
      if (perms.length > 0) {
        await db.insert(rolePermissionsTable).values(perms.map(p => ({ ...p, roleId: role.id })));
      }

      // Resync widget config (Finance: only Deals visible)
      await db.delete(roleDashboardWidgetsTable).where(eq(roleDashboardWidgetsTable.roleId, role.id));
      const widgets = [
        { widgetKey: "nav_dashboard",          visible: false },
        { widgetKey: "nav_leads",              visible: false },
        { widgetKey: "nav_contacts",           visible: false },
        { widgetKey: "nav_deals",              visible: true },
        { widgetKey: "nav_activities",         visible: false },
        { widgetKey: "nav_reports",            visible: false },
        { widgetKey: "nav_users",              visible: false },
        { widgetKey: "nav_audit",              visible: false },
        { widgetKey: "nav_roles",              visible: false },
        { widgetKey: "nav_settings",           visible: false },
        { widgetKey: "widget_stats_bar",       visible: false },
        { widgetKey: "widget_stage_chart",     visible: false },
        { widgetKey: "widget_funnel",          visible: false },
        { widgetKey: "widget_recent_activity", visible: false },
      ];
      await db.insert(roleDashboardWidgetsTable).values(widgets.map(w => ({ ...w, roleId: role.id })));
    }

    logger.info({ count: financeRoles.length }, "resyncFinanceRole: permissions + widgets updated");
  } catch (e) {
    logger.error({ err: e }, "resyncFinanceRole failed — non-fatal, continuing startup");
  }
}
