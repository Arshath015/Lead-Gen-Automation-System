import { Router, type IRouter, type Request, type Response } from "express";
import { db, notificationPreferencesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePermission } from "../lib/permissions";
import { sendNotificationConfirmationEmail } from "../lib/email";

const router: IRouter = Router();

const PREF_KEYS = [
  "emailNotificationsEnabled",
  "notifyOnSubordinateManualLead",
  "notifyOnManagerActivity",
  "notifyOnAdminActivity",
  "notifyCallReminders",
  "notifyMeetingTaskReminders",
  "notifyNewLead",
  "notifyStatusChange",
  "notifyImportantFieldChange",
  "notifyUrgentEscalation",
] as const;

const DEFAULT_PREFS = Object.fromEntries(PREF_KEYS.map(k => [k, false])) as Record<(typeof PREF_KEYS)[number], boolean>;

router.get("/settings/notification-preferences", requirePermission("settings.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [prefs] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, req.user.id))
    .limit(1);
  res.json(prefs ?? DEFAULT_PREFS);
});

router.put("/settings/notification-preferences", requirePermission("settings.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.user.id;
  const wid = req.user.workspaceId ?? null;

  const updates: Partial<Record<(typeof PREF_KEYS)[number], boolean>> = {};
  for (const key of PREF_KEYS) {
    if (key in req.body && typeof req.body[key] === "boolean") {
      updates[key] = req.body[key];
    }
  }

  const [existing] = await db
    .select({ id: notificationPreferencesTable.id })
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);

  let prefs;
  if (existing) {
    [prefs] = await db
      .update(notificationPreferencesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(notificationPreferencesTable.userId, userId))
      .returning();
  } else {
    [prefs] = await db
      .insert(notificationPreferencesTable)
      .values({ userId, workspaceId: wid, ...updates })
      .returning();
  }

  // Send confirmation email whenever email notifications are enabled on save
  if (prefs?.emailNotificationsEnabled) {
    Promise.resolve().then(async () => {
      try {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.numId, userId)).limit(1);
        if (user?.email) {
          const name = (`${user.firstName ?? ""} ${user.lastName ?? ""}`).trim() || user.email;
          await sendNotificationConfirmationEmail(user.email, name);
        }
      } catch {}
    }).catch(() => {});
  }

  res.json(prefs);
});

export default router;
