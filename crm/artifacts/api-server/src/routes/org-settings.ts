import { Router, type IRouter, type Request, type Response } from "express";
import { db, orgSettingsTable, workspacesTable, auditLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";

const router: IRouter = Router();

async function getOrCreateForWorkspace(wid: number | null) {
  const [row] = await db.select().from(orgSettingsTable)
    .where(wsFilter(orgSettingsTable.workspaceId, wid))
    .limit(1);
  if (row) return row;
  const [created] = await db.insert(orgSettingsTable)
    .values({ workspaceId: wid })
    .returning();
  return created;
}

router.get("/settings/org", requirePermission("settings.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const row = await getOrCreateForWorkspace(wid);

  // Merge company profile fields stored in workspacesTable (set during onboarding)
  let companyProfile: { businessType?: string | null; industry?: string | null; employeeCount?: string | null; website?: string | null } = {};
  if (wid !== null) {
    const [ws] = await db.select({
      businessType: workspacesTable.businessType,
      industry: workspacesTable.industry,
      employeeCount: workspacesTable.employeeCount,
      website: workspacesTable.website,
    }).from(workspacesTable).where(eq(workspacesTable.id, wid)).limit(1);
    if (ws) companyProfile = ws;
  }

  res.json({ ...row, ...companyProfile });
});

router.patch("/settings/org", requirePermission("settings.edit"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const wid = req.user.workspaceId ?? null;
  const row = await getOrCreateForWorkspace(wid);

  const {
    name, currency, timezone,
    logoUrl, primaryColor, theme, domain,
    businessEmail, businessPhone, address,
    smtpConfig, whatsappConfig, preferences,
    businessType, industry, employeeCount, website,
  } = req.body;

  const updates: Partial<typeof orgSettingsTable.$inferInsert> = {};

  // Identity
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof logoUrl === "string") updates.logoUrl = logoUrl.trim() || null;
  if (typeof primaryColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(primaryColor.trim())) {
    updates.primaryColor = primaryColor.trim();
  }
  if (typeof theme === "string" && ["light", "dark", "system"].includes(theme)) {
    updates.theme = theme;
  }
  if (typeof domain === "string") updates.domain = domain.trim() || null;

  // Contact
  if (typeof businessEmail === "string") updates.businessEmail = businessEmail.trim() || null;
  if (typeof businessPhone === "string") updates.businessPhone = businessPhone.trim() || null;
  if (typeof address === "string") updates.address = address.trim() || null;

  // Regional
  if (typeof currency === "string" && currency.trim()) updates.currency = currency.trim().toUpperCase();
  if (typeof timezone === "string" && timezone.trim()) updates.timezone = timezone.trim();

  // Grouped config blocks
  if (smtpConfig !== undefined) updates.smtpConfig = smtpConfig;
  if (whatsappConfig !== undefined) updates.whatsappConfig = whatsappConfig;
  if (preferences !== undefined) updates.preferences = preferences;

  const [updated] = await db.update(orgSettingsTable)
    .set(updates)
    .where(and(eq(orgSettingsTable.id, row.id), wsFilter(orgSettingsTable.workspaceId, wid)))
    .returning();

  // Also persist company profile fields (from onboarding wizard) back to workspacesTable
  if (wid !== null) {
    const wsUpdates: Partial<typeof workspacesTable.$inferInsert> = {};
    if (typeof name === "string" && name.trim()) wsUpdates.name = name.trim();
    if (typeof businessType === "string") wsUpdates.businessType = businessType.trim() || null;
    if (typeof industry === "string") wsUpdates.industry = industry.trim() || null;
    if (typeof employeeCount === "string") wsUpdates.employeeCount = employeeCount.trim() || null;
    if (typeof website === "string") wsUpdates.website = website.trim() || null;
    if (Object.keys(wsUpdates).length > 0) {
      await db.update(workspacesTable).set(wsUpdates).where(eq(workspacesTable.id, wid));
    }
  }

  await db.insert(auditLogsTable).values({
    leadId: null,
    userId: req.user.id,
    action: "workspace_settings_changed",
    tableName: "org_settings",
    fieldName: Object.keys(updates).join(", ") || null,
    oldValue: JSON.stringify(Object.fromEntries(Object.keys(updates).map(k => [k, (row as any)[k]]))),
    newValue: JSON.stringify(updates),
    ipAddress: req.ip ?? null,
    workspaceId: wid,
  }).catch(() => {});

  res.json(updated);
});

export default router;
