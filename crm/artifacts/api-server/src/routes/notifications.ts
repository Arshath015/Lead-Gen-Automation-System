import { Router, type IRouter, type Request, type Response } from "express";
import { db, notificationsTable, leadsTable, followupsTable, tasksTable, scheduledActivitiesTable, usersTable, notificationPreferencesTable } from "@workspace/db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { wsFilter } from "../lib/workspaceScope";
import { requirePermission } from "../lib/permissions";
import { sendNotificationConfirmationEmail } from "../lib/email";

const router: IRouter = Router();

router.get("/notifications", requirePermission("notifications.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const wid = req.user.workspaceId ?? null;

  const now = new Date();
  const in15 = new Date(now.getTime() + 15 * 60 * 1000);

  // ── Auto-create activity_due notifications for scheduled activities due within 15 min ──
  const upcoming = await db.select().from(scheduledActivitiesTable)
    .where(and(
      eq(scheduledActivitiesTable.status, "open"),
      gte(scheduledActivitiesTable.dueAt, now),
      lte(scheduledActivitiesTable.dueAt, in15),
      wsFilter(scheduledActivitiesTable.workspaceId, wid),
    ));

  for (const act of upcoming) {
    if (!act.ownerId) continue;
    const alreadyNotified = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, act.ownerId),
        eq(notificationsTable.type, "activity_due"),
        eq(notificationsTable.scheduledActivityId, act.id),
      ));
    if (alreadyNotified.length === 0) {
      await db.insert(notificationsTable).values({
        userId: act.ownerId,
        type: "activity_due",
        title: `${act.type.charAt(0).toUpperCase() + act.type.slice(1)} due soon: ${act.subject}`,
        body: `Due at ${act.dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        scheduledActivityId: act.id,
        leadId: act.leadId ?? null,
        workspaceId: wid,
      }).catch(() => {});
    }
  }

  // The cron creates followup_due notifications AND owns reminder email.
  // Creating a notification here first would make the cron's dedup check skip
  // the email. Polling only reads the rows claimed by the cron.

  const allUserNotifs = await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.userId, req.user.id), wsFilter(notificationsTable.workspaceId, wid)))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  const enriched = await Promise.all(allUserNotifs.map(async (n) => {
    const [lead] = n.leadId
      ? await db.select().from(leadsTable).where(eq(leadsTable.id, n.leadId))
      : [null];
    return { ...n, leadCompanyName: lead?.companyName ?? null, createdAt: n.createdAt.toISOString() };
  }));

  const unreadCount = allUserNotifs.filter(n => !n.read).length;

  // Count due follow-ups and tasks (scoped to workspace)
  const allFollowups = await db.select().from(followupsTable)
    .where(and(eq(followupsTable.status, "pending"), wsFilter(followupsTable.workspaceId, wid)));
  const allTasks = await db.select().from(tasksTable)
    .where(wsFilter(tasksTable.workspaceId, wid));
  const dueTasks = allTasks.filter(t => t.status === "todo" && t.dueDate && t.dueDate <= now);
  const dueFollowups = allFollowups.filter(f => f.scheduledAt <= now);

  let dueCount: number;
  if (req.user.role === "bd") {
    dueCount = dueTasks.filter(t => t.assignedToId === req.user.id).length + dueFollowups.length;
  } else {
    dueCount = dueTasks.length + dueFollowups.length;
  }

  // Coming due count: scheduled activities within 15 min for this user
  const myUpcoming = upcoming.filter(a => a.ownerId === req.user.id);
  const comingDueCount = myUpcoming.length;

  res.json({ notifications: enriched, unreadCount, dueCount, comingDueCount });
});

// ── Test email: lets users verify email delivery from Settings → Notifications ──
router.post("/notifications/test-email", requirePermission("notifications.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select({
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
  }).from(usersTable).where(eq(usersTable.numId, req.user.id));

  if (!user?.email) {
    res.status(400).json({ error: "No email address on your account" });
    return;
  }

  const name = (`${user.firstName ?? ""} ${user.lastName ?? ""}`).trim() || user.email;
  await sendNotificationConfirmationEmail(user.email, name);
  res.json({ ok: true, sentTo: user.email });
});

router.post("/notifications/read-all", requirePermission("notifications.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const wid = req.user.workspaceId ?? null;
  const unread = await db.select().from(notificationsTable)
    .where(and(eq(notificationsTable.userId, req.user.id), eq(notificationsTable.read, false), wsFilter(notificationsTable.workspaceId, wid)));
  if (unread.length > 0) {
    await db.update(notificationsTable).set({ read: true })
      .where(and(eq(notificationsTable.userId, req.user.id), eq(notificationsTable.read, false), wsFilter(notificationsTable.workspaceId, wid)));
  }
  res.json({ updated: unread.length });
});

router.post("/notifications/:id/read", requirePermission("notifications.view"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  const [notif] = await db.update(notificationsTable).set({ read: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user.id)))
    .returning();
  if (!notif) { res.status(404).json({ error: "Not found" }); return; }
  const [lead] = notif.leadId
    ? await db.select().from(leadsTable).where(eq(leadsTable.id, notif.leadId))
    : [null];
  res.json({ ...notif, leadCompanyName: lead?.companyName ?? null, createdAt: notif.createdAt.toISOString() });
});

export default router;
