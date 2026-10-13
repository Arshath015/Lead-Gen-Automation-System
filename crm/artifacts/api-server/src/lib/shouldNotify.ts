import { db, notificationPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type NotificationType =
  | "notifyOnSubordinateManualLead"
  | "notifyOnManagerActivity"
  | "notifyOnAdminActivity"
  | "notifyCallReminders"
  | "notifyMeetingTaskReminders"
  | "notifyNewLead"
  | "notifyStatusChange"
  | "notifyImportantFieldChange"
  | "notifyUrgentEscalation";

/**
 * Returns true if the user has opted into the given email notification type.
 * Always checks emailNotificationsEnabled master switch first.
 * Returns false if no preferences row exists (opt-in model — nothing on by default).
 */
export async function shouldNotify(userId: number, type: NotificationType): Promise<boolean> {
  try {
    const [prefs] = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, userId))
      .limit(1);
    if (!prefs) return false;
    if (!prefs.emailNotificationsEnabled) return false;
    return Boolean(prefs[type as keyof typeof prefs]);
  } catch {
    return false;
  }
}
