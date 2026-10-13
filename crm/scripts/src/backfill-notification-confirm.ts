/**
 * backfill-notification-confirm — one-time backfill script.
 *
 * Finds every user who already has emailNotificationsEnabled = true and sends
 * them the standard notification confirmation/test email once.
 *
 * Usage (dry run — shows count only):
 *   pnpm --filter @workspace/scripts run backfill-notification-confirm
 *
 * Usage (actually send):
 *   pnpm --filter @workspace/scripts run backfill-notification-confirm -- --execute
 *
 * Required env (same as api-server):
 *   RESEND_API_KEY  — Resend API key
 *   EMAIL_FROM      — optional sender override (defaults to onboarding@resend.dev)
 */

import { db, notificationPreferencesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Resend } from "resend";

const execute = process.argv.includes("--execute");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM ?? "Rapport <onboarding@resend.dev>";

async function sendConfirmation(to: string, name: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log(`  [skip] No RESEND_API_KEY — would have emailed ${to}`);
    return;
  }
  const resend = new Resend(RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Email notifications are now active for your Rapport account",
      html: `<p>Hi ${name},</p>
             <p>✅ Your notification preferences have been saved and email delivery is <strong>working correctly</strong>.</p>
             <p>You will now receive email alerts for the notification types you have enabled — such as new leads assigned to you, stage changes, and follow-up reminders.</p>
             <p>You can update your preferences at any time from your <strong>Settings → Notifications</strong> page.</p>
             <p style="color:#888;font-size:12px;">This is a one-time backfill confirmation sent to all users who had email notifications enabled before this feature was deployed.</p>`,
    });
    console.log(`  ✉  Sent to ${name} <${to}>`);
  } catch (err) {
    console.error(`  ✗  Failed for ${to}:`, err);
  }
}

async function main() {
  console.log("=== Notification confirmation backfill ===\n");

  // Find all users with emailNotificationsEnabled = true
  const enabledPrefs = await db
    .select({ userId: notificationPreferencesTable.userId })
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.emailNotificationsEnabled, true));

  if (enabledPrefs.length === 0) {
    console.log("No users have email notifications enabled. Nothing to do.");
    process.exit(0);
  }

  // Resolve emails + names from users table
  const targets: { email: string; name: string }[] = [];
  for (const pref of enabledPrefs) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.numId, pref.userId))
      .limit(1);
    if (user?.email) {
      const name = (`${user.firstName ?? ""} ${user.lastName ?? ""}`).trim() || user.email;
      targets.push({ email: user.email, name });
    }
  }

  console.log(`Users with email notifications enabled: ${targets.length}`);
  targets.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} <${t.email}>`));
  console.log();

  if (!execute) {
    console.log("DRY RUN — no emails sent.");
    console.log("Re-run with --execute to actually send:");
    console.log("  pnpm --filter @workspace/scripts run backfill-notification-confirm -- --execute");
    process.exit(0);
  }

  console.log("Sending confirmation emails...\n");
  for (const target of targets) {
    await sendConfirmation(target.email, target.name);
  }

  console.log(`\nDone. Sent to ${targets.length} user(s).`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
