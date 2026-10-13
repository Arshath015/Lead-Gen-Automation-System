import { Resend } from "resend";
import { logger } from "./logger";
import { getAppUrl } from "./app-url";

const resend = new Resend(process.env.RESEND_API_KEY);
// Bound the HTTP request itself (not just the caller's wait), so the database
// row lock is held until the transport settles or is aborted.
class TimedReminderResend extends Resend {
  override fetchRequest<T>(path: string, options: RequestInit = {}) {
    return super.fetchRequest<T>(path, { ...options, signal: AbortSignal.timeout(20_000) });
  }
}
const reminderResend = new TimedReminderResend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "Rapport <onboarding@resend.dev>";
const SUPER_ADMIN_EMAIL = "arshathfarwyz015@gmail.com";

async function send(to: string, subject: string, html: string, idempotencyKey?: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    if (idempotencyKey) throw new Error("RESEND_API_KEY is not configured for reminder delivery");
    logger.warn({ to, subject }, "[email] skipped — RESEND_API_KEY not set");
    return;
  }
  // Resend SDK v2+ returns { data, error } instead of throwing.
  // Always check the error field — a try-catch alone misses these failures.
  const { data, error } = await (idempotencyKey ? reminderResend : resend).emails.send(
    { from: FROM, to, subject, html },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
  if (error) {
    logger.error({ error, from: FROM, to, subject }, "[email] Resend API error — email NOT delivered");
    if (idempotencyKey) throw new Error(`Resend reminder delivery failed: ${error.message}`);
  } else {
    logger.info({ messageId: data?.id, to, subject }, "[email] sent successfully via Resend");
  }
}

export async function sendNewSignupNotification(name: string, email: string, requestedRole: string) {
  await send(
    SUPER_ADMIN_EMAIL,
    `New account request: ${name}`,
    `<p>A new account request has been submitted.</p>
     <p><strong>Name:</strong> ${name}<br>
     <strong>Email:</strong> ${email}<br>
     <strong>Requested role:</strong> ${requestedRole}</p>
     <p>Please review and approve or reject this request in the <strong>Account Approvals</strong> page.</p>`,
  );
}

export async function sendWelcomeEmail(name: string, email: string) {
  await send(
    email,
    "Your Rapport account has been approved",
    `<p>Hi ${name},</p>
     <p>Great news — your Rapport account has been approved. You can now sign in at your team's CRM.</p>
     <p>If you have any questions, reach out to your admin.</p>`,
  );
}

export async function sendRejectionEmail(name: string, email: string, reason?: string | null) {
  await send(
    email,
    "Your Rapport account request",
    `<p>Hi ${name},</p>
     <p>We're sorry — your account request was not approved.</p>
     ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
     <p>Please contact your administrator if you believe this is an error.</p>`,
  );
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  await send(
    email,
    "Reset your Rapport password",
    `<p>You requested a password reset for your Rapport account.</p>
     <p><a href="${resetUrl}" style="background:#0B5FB0;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a></p>
     <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
  );
}

export async function sendNewLeadNotification(to: string, ownerName: string, companyName: string, stage: string) {
  await send(
    to,
    `New lead assigned: ${companyName}`,
    `<p>Hi ${ownerName},</p>
     <p>A new lead has been assigned to you in Rapport.</p>
     <p><strong>Company:</strong> ${companyName}<br>
     <strong>Stage:</strong> ${stage}</p>
     <p>Log in to Rapport to view and manage this lead.</p>`,
  );
}

export async function sendSubordinateLeadNotification(to: string, managerName: string, subordinateName: string, companyName: string) {
  await send(
    to,
    `New lead added by ${subordinateName}: ${companyName}`,
    `<p>Hi ${managerName},</p>
     <p><strong>${subordinateName}</strong> has manually added a new lead to Rapport.</p>
     <p><strong>Company:</strong> ${companyName}</p>
     <p>Log in to Rapport to review this lead.</p>`,
  );
}

export async function sendStageChangeNotification(to: string, ownerName: string, companyName: string, fromStage: string, toStage: string) {
  await send(
    to,
    `Lead stage updated: ${companyName}`,
    `<p>Hi ${ownerName},</p>
     <p>A lead you own has moved to a new pipeline stage.</p>
     <p><strong>Company:</strong> ${companyName}<br>
     <strong>From:</strong> ${fromStage}<br>
     <strong>To:</strong> ${toStage}</p>
     <p>Log in to Rapport to view the lead.</p>`,
  );
}

export async function sendLeadAssignedNotification(to: string, ownerName: string, companyName: string, assignedByName: string) {
  await send(
    to,
    `Lead assigned to you: ${companyName}`,
    `<p>Hi ${ownerName},</p>
     <p><strong>${assignedByName}</strong> has assigned a lead to you in Rapport.</p>
     <p><strong>Company:</strong> ${companyName}</p>
     <p>Log in to Rapport to view and manage this lead.</p>`,
  );
}

export async function sendFollowupReminderEmail(
  to: string,
  name: string,
  companyName: string,
  contactPerson: string,
  scheduledAt: Date,
  leadId: number,
  idempotencyKey: string,
) {
  // Bug 1 fix: always format in IST regardless of server timezone (server runs UTC).
  // toLocaleTimeString without timeZone uses the server's local clock — UTC on this
  // host — which was displaying 12:35 PM for a 6:05 PM IST follow-up.
  const IST = "Asia/Kolkata";
  const timeStr = scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST });
  const dateStr = scheduledAt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: IST });

  // Bug 2 fix: build a fully-qualified URL so the email link isn't a bare path.
  // APP_URL must be set in the environment (e.g. https://your-domain.example).
  const appUrl = getAppUrl();
  const leadUrl = `${appUrl}/leads/${leadId}`;

  await send(
    to,
    `Follow-up reminder: ${companyName} — ${timeStr}`,
    `<p>Hi ${name},</p>
     <p>You have a follow-up coming up soon.</p>
     <table style="border-collapse:collapse;margin:12px 0;">
       <tr><td style="padding:4px 12px 4px 0;color:#888;font-size:13px;">Company</td><td style="padding:4px 0;font-weight:600;">${companyName}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#888;font-size:13px;">Contact</td><td style="padding:4px 0;">${contactPerson}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#888;font-size:13px;">Scheduled</td><td style="padding:4px 0;">${dateStr} at ${timeStr}</td></tr>
     </table>
     <p><a href="${leadUrl}" style="background:#0B5FB0;color:white;padding:8px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px;">Open Lead</a></p>
      <p style="color:#aaa;font-size:12px;">You are receiving this because follow-up reminders are enabled in your notification settings.</p>`,
    idempotencyKey,
  );
}

export async function sendBulkLeadAssignedNotification(
  to: string,
  ownerName: string,
  leadNames: string[],
  assignedByName: string,
) {
  const count = leadNames.length;
  const listHtml = leadNames
    .map(n => `<li style="padding:2px 0;">${n}</li>`)
    .join("");
  await send(
    to,
    `${count} lead${count === 1 ? "" : "s"} assigned to you by ${assignedByName}`,
    `<p>Hi ${ownerName},</p>
     <p><strong>${assignedByName}</strong> has assigned ${count} lead${count === 1 ? "" : "s"} to you in Rapport.</p>
     <ul style="margin:8px 0 12px;padding-left:20px;">${listHtml}</ul>
     <p>Log in to Rapport to view and manage your leads.</p>`,
  );
}

export async function sendNotificationConfirmationEmail(to: string, name: string) {
  await send(
    to,
    "Email notifications are now active for your Rapport account",
    `<p>Hi ${name},</p>
     <p>✅ Your notification preferences have been saved and email delivery is <strong>working correctly</strong>.</p>
     <p>You will now receive email alerts for the notification types you have enabled — such as new leads assigned to you, stage changes, and follow-up reminders.</p>
     <p>You can update your preferences at any time from your <strong>Settings → Notifications</strong> page.</p>
     <p style="color:#888;font-size:12px;">This confirmation is sent each time you save your notification settings with email enabled, so you always have a live test of delivery on file.</p>`,
  );
}
