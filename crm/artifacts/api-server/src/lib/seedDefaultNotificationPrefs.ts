/**
 * seedDefaultNotificationPrefs.ts
 *
 * Two exports:
 *
 *  1. seedDefaultNotificationPrefs(userId, workspaceId)
 *     - Call immediately after every new *active* user row is inserted.
 *     - Uses ON CONFLICT DO NOTHING — completely safe if a row already exists.
 *
 *  2. backfillDefaultNotificationPrefs()
 *     - One-time startup task: inserts default prefs for every user that has
 *       NO notification_preferences row at all.
 *     - Users who already have a row (even with everything disabled) are
 *       NEVER touched — their explicit choices are preserved.
 */

import { db, usersTable, notificationPreferencesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/** The defaults we want every new user to start with. */
const DEFAULT_PREFS = {
  emailNotificationsEnabled:   true,
  notifyNewLead:               true,   // lead assigned to you
  notifyMeetingTaskReminders:  true,   // follow-up due reminders
  notifyStatusChange:          true,   // stage/status changes on your leads
  notifyUrgentEscalation:      true,   // urgent priority alerts
  // leave specialist / manager types off by default:
  // notifyOnSubordinateManualLead, notifyOnManagerActivity,
  // notifyOnAdminActivity, notifyCallReminders, notifyImportantFieldChange
} as const;

/**
 * Idempotent: inserts one default prefs row for a freshly-created active user.
 * Safe to call even if a row already exists (onConflictDoNothing).
 */
export async function seedDefaultNotificationPrefs(
  userId: number,
  workspaceId: number | null,
): Promise<void> {
  try {
    await db
      .insert(notificationPreferencesTable)
      .values({ userId, workspaceId: workspaceId ?? null, ...DEFAULT_PREFS })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, userId }, "[notification-prefs] failed to seed default prefs for user");
  }
}

/**
 * One-time startup backfill.
 *
 * Inserts default prefs for every user (any accountStatus) that currently has
 * NO notification_preferences row. Users with an existing row — even if every
 * toggle is off — are completely untouched.
 *
 * Returns the count of rows inserted so the startup log shows what happened.
 */
export async function backfillDefaultNotificationPrefs(): Promise<void> {
  try {
    const result = await db.execute(sql`
      INSERT INTO notification_preferences
        (user_id, workspace_id,
         email_notifications_enabled,
         notify_new_lead,
         notify_meeting_task_reminders,
         notify_status_change,
         notify_urgent_escalation)
      SELECT
        u.num_id,
        u.workspace_id,
        true, true, true, true, true
      FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.num_id
      WHERE np.id IS NULL
      ON CONFLICT (user_id) DO NOTHING
    `);
    const count = (result as any).rowCount ?? 0;
    if (count > 0) {
      logger.info(
        { count },
        "[notification-prefs] backfill complete — seeded default prefs for users with no row",
      );
    } else {
      logger.info(
        "[notification-prefs] backfill: all users already have a preferences row, nothing to do",
      );
    }
  } catch (err) {
    logger.error({ err }, "[notification-prefs] backfill failed");
  }
}
