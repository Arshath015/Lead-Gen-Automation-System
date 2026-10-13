/**
 * followup-reminder-job.ts
 *
 * A server-side cron job that runs every 2 minutes, completely independent of
 * whether any browser tab has the CRM open.
 *
 * For every pending follow-up scheduled within the next 15 minutes it:
 *   1. Creates a followup_due in-app notification (once per follow-up, deduped
 *      by the followupId FK on notificationsTable).
 *   2. Sends an email reminder to the lead owner if they have
 *      emailNotificationsEnabled + notifyMeetingTaskReminders turned on.
 *
 * The cron is the only writer for followup_due notifications and email claims.
 */

import { schedule } from "node-cron";
import {
  db,
  pool,
  followupsTable,
  followupReminderDeliveriesTable,
  leadsTable,
  notificationsTable,
  notificationPreferencesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, gte, lte, lt } from "drizzle-orm";
import { sendFollowupReminderEmail } from "./email";
import { logger } from "./logger";
import { attemptReminderDelivery, canAttemptReminder, MAX_REMINDER_RETRY_AGE_MS, reminderEligible, reminderKey, shouldRetryReminder } from "./reminder-delivery";

export function startFollowupReminderJob(): void {
  // Run every 2 minutes — well within the 15-minute reminder window so no
  // follow-up can slip through even under light server load.
  schedule("*/2 * * * *", async () => {
    // The API may run on several instances. Hold a session-level PostgreSQL
    // advisory lock throughout the scan and email send so only one runs it.
    const client = await pool.connect().catch((err) => {
      logger.error({ err }, "[followup-reminder-job] database unavailable");
      return null;
    });
    if (!client) return;
    let locked = false;
    try {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(54369, 26) AS acquired",
      );
      locked = result.rows[0]?.acquired === true;
      if (!locked) return;
      await runFollowupReminderCheck();
    } catch (err) {
      logger.error({ err }, "[followup-reminder-job] uncaught error in job run");
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(54369, 26)");
        } catch (err) {
          logger.error({ err }, "[followup-reminder-job] failed to release lock; discarding connection");
          client.release(true);
          return;
        }
      }
      client.release();
    }
  });

  logger.info("[followup-reminder-job] scheduled — runs every 2 minutes");
}

async function runFollowupReminderCheck(): Promise<void> {
  const now = new Date();
  // 5-minute look-back window: catches followups that have just passed but the
  // job hadn't run yet (e.g. scheduled at 3:00 PM, job runs at 3:02 PM).
  const fiveAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const in15   = new Date(now.getTime() + 15 * 60 * 1000);

  logger.info(
    { windowStart: fiveAgo.toISOString(), windowEnd: in15.toISOString() },
    "[followup-reminder-job] running check",
  );

  // Fetch ALL pending follow-ups due within [-5 min, +15 min] window across
  // every workspace. No wsFilter here — this is a privileged server-side scan.
  const rows = await db
    .select({
      id: followupsTable.id,
      scheduledAt: followupsTable.scheduledAt,
      generation: followupsTable.reminderGeneration,
    })
    .from(followupsTable)
    .where(
      and(
        eq(followupsTable.status, "pending"),
        gte(followupsTable.scheduledAt, fiveAgo),
        lte(followupsTable.scheduledAt, in15),
      ),
    );

  // A failed email near the end of the original look-back window still gets
  // its bounded retries. Do not widen first-send behavior.
  const retryRows = await db.select({
    id: followupsTable.id,
    scheduledAt: followupsTable.scheduledAt,
    generation: followupsTable.reminderGeneration,
  }).from(followupReminderDeliveriesTable)
    .innerJoin(followupsTable, eq(followupReminderDeliveriesTable.followupId, followupsTable.id))
    .where(and(
      eq(followupReminderDeliveriesTable.emailStatus, "retry"),
      lt(followupReminderDeliveriesTable.attempts, 3),
      lte(followupReminderDeliveriesTable.nextRetryAt, now),
      gte(followupReminderDeliveriesTable.scheduledAt, new Date(now.getTime() - MAX_REMINDER_RETRY_AGE_MS)),
      lte(followupReminderDeliveriesTable.scheduledAt, in15),
      eq(followupReminderDeliveriesTable.generation, followupsTable.reminderGeneration),
    ));
  const candidates = new Map<string, { id: number; scheduledAt: Date; generation: number; retry: boolean }>();
  for (const row of rows) candidates.set(`${row.id}:${row.generation}`, { ...row, retry: false });
  for (const row of retryRows) candidates.set(`${row.id}:${row.generation}`, { ...row, retry: true });
  logger.info({ count: candidates.size }, "[followup-reminder-job] due follow-ups found");

  if (candidates.size === 0) return;

  let notified = 0;
  let emailed = 0;

  for (const candidate of candidates.values()) {
    try {
      // Hold the follow-up row lock until Resend acknowledges or fails. A
      // concurrent PATCH/DELETE waits, so it cannot invalidate the checked
      // status/schedule between eligibility and send.
      const result = await db.transaction(async (tx) => {
        const [followup] = await tx.select().from(followupsTable)
          .where(eq(followupsTable.id, candidate.id)).for("update");
        const checkedAt = new Date();
        if (!reminderEligible(followup, candidate.scheduledAt, checkedAt, candidate.generation, candidate.retry)) {
          return { notified: false, emailed: false };
        }
        const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, followup!.leadId));
        if (!lead || lead.workspaceId !== followup!.workspaceId) {
          return { notified: false, emailed: false };
        }
        const ownerId = lead.ownerId ?? followup!.createdById;
        if (!ownerId) return { notified: false, emailed: false };

        const [prefs] = await tx.select({
          emailEnabled: notificationPreferencesTable.emailNotificationsEnabled,
          meetingReminders: notificationPreferencesTable.notifyMeetingTaskReminders,
        }).from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, ownerId));
        const [owner] = await tx.select({
          email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName,
        }).from(usersTable).where(eq(usersTable.numId, ownerId));
        const emailAllowed = Boolean(prefs?.emailEnabled && prefs?.meetingReminders && owner?.email);
        const companyName = lead.companyName ?? "Unknown";
        const contactPerson = lead.contactPerson ?? "Unknown";
        const ownerName = (`${owner?.firstName ?? ""} ${owner?.lastName ?? ""}`).trim() || owner?.email || "";
        const key = reminderKey(followup!.id, followup!.reminderGeneration, followup!.scheduledAt, ownerId);

        const [created] = await tx.insert(followupReminderDeliveriesTable).values({
          followupId: followup!.id,
          generation: followup!.reminderGeneration,
          scheduledAt: followup!.scheduledAt,
          userId: ownerId,
          workspaceId: followup!.workspaceId,
          idempotencyKey: key,
          emailTo: emailAllowed ? owner!.email : null,
          ownerName: emailAllowed ? ownerName : null,
          companyName,
          contactPerson,
          leadId: followup!.leadId,
          emailStatus: emailAllowed ? "pending" : "skipped",
        }).onConflictDoNothing().returning();
        const [delivery] = created ? [created] : await tx.select().from(followupReminderDeliveriesTable)
          .where(and(
            eq(followupReminderDeliveriesTable.followupId, followup!.id),
            eq(followupReminderDeliveriesTable.generation, followup!.reminderGeneration),
            eq(followupReminderDeliveriesTable.userId, ownerId),
          ));
        if (!delivery) throw new Error("Reminder claim missing after conflict");

        if (created) {
          // A notification from the older cron may already represent this
          // schedule; do not send a second email during a rollout.
          const [oldNotification] = await tx.select({ id: notificationsTable.id })
            .from(notificationsTable).where(and(
              eq(notificationsTable.followupId, followup!.id),
              eq(notificationsTable.userId, ownerId),
              eq(notificationsTable.type, "followup_due"),
              gte(notificationsTable.createdAt, followup!.updatedAt),
            )).limit(1);
          if (oldNotification) {
            await tx.update(followupReminderDeliveriesTable)
              .set({ emailStatus: "skipped", updatedAt: checkedAt })
              .where(eq(followupReminderDeliveriesTable.id, delivery.id));
            return { notified: false, emailed: false };
          }
          const timeStr = followup!.scheduledAt.toLocaleTimeString("en-IN", {
            hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
          });
          await tx.insert(notificationsTable).values({
            userId: ownerId, type: "followup_due",
            title: `Follow-up due soon: ${companyName}`,
            body: `Scheduled at ${timeStr} with ${contactPerson}`,
            followupId: followup!.id, leadId: followup!.leadId,
            workspaceId: followup!.workspaceId,
          });
        }

        if (!emailAllowed || !canAttemptReminder(delivery, checkedAt) ||
            !delivery.emailTo || !delivery.ownerName) {
          if (!emailAllowed && (delivery.emailStatus === "pending" || delivery.emailStatus === "retry")) {
            await tx.update(followupReminderDeliveriesTable)
              .set({ emailStatus: "skipped", updatedAt: checkedAt })
              .where(eq(followupReminderDeliveriesTable.id, delivery.id));
          }
          return { notified: Boolean(created), emailed: false };
        }

        const sent = await attemptReminderDelivery(delivery, checkedAt,
          async () => {
            // The reminder transport is abortable and bounded to 20 seconds.
            // Reuse the same Resend key on retries, including a crash between
            // acceptance and the database commit.
            await sendFollowupReminderEmail(
              delivery.emailTo!, delivery.ownerName!, delivery.companyName ?? "Unknown",
              delivery.contactPerson ?? "Unknown", delivery.scheduledAt,
              delivery.leadId ?? 0, delivery.idempotencyKey,
            );
          },
          async (attempts) => {
            await tx.update(followupReminderDeliveriesTable)
              .set({ emailStatus: "sent", deliveredAt: new Date(), nextRetryAt: null, attempts, updatedAt: new Date() })
              .where(eq(followupReminderDeliveriesTable.id, delivery.id));
          },
          async (attempts, nextRetryAt, err) => {
            logger.warn({ err, followupId: followup!.id, attempts }, "[followup-reminder-job] email retry scheduled");
            const retryable = shouldRetryReminder(attempts, nextRetryAt, delivery.scheduledAt);
            await tx.update(followupReminderDeliveriesTable)
              .set({ emailStatus: retryable ? "retry" : "exhausted", attempts,
                nextRetryAt: retryable ? nextRetryAt : null, updatedAt: new Date() })
              .where(eq(followupReminderDeliveriesTable.id, delivery.id));
          },
        );
        return { notified: Boolean(created), emailed: sent };
      });
      if (result.notified) notified++;
      if (result.emailed) emailed++;
    } catch (err) {
      logger.error({ err, followupId: candidate.id }, "[followup-reminder-job] failed to process reminder");
    }
  }

  if (notified > 0) {
    logger.info(
      { notified, emailed },
      "[followup-reminder-job] sent follow-up reminders",
    );
  }
}
