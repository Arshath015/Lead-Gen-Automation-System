import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/runMigrations";
import { seedSuperAdmin, ensureDefaultStages } from "./lib/seedSuperAdmin";
import { seedProductionData } from "./lib/seedProductionData";
import { wipeDatabase } from "./lib/wipeDatabase";
import { startFollowupReminderJob } from "./lib/followup-reminder-job";
import { resyncFinanceRole } from "./lib/resyncFinanceRole";
import { backfillDefaultNotificationPrefs } from "./lib/seedDefaultNotificationPrefs";
import { reconcileLeadFollowupDates } from "./lib/reconcileLeadFollowupDates";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Development retains its existing startup setup. In production, migration
// and reconciliation are separate, explicit cutover operations, never implicit
// side effects of restarting an API replica.
const isProduction = process.env.NODE_ENV === "production";
const runStartupMigrations = !isProduction || process.env.RUN_STARTUP_MIGRATIONS === "true";
const runStartupMaintenance = !isProduction || process.env.RUN_STARTUP_MAINTENANCE === "true";

if (runStartupMigrations) {
  try {
    await runMigrations();
  } catch (e) {
    logger.error({ err: e }, "Schema migration failed — aborting startup");
    process.exit(1);
  }
} else {
  logger.info("Startup migrations disabled in production; run only as an explicit cutover step");
}

// ── Step 1: Optional one-time DB wipe ────────────────────────────────────────
// Set WIPE_DB_ON_START=true to truncate every application table on startup.
// Remove this env var after the wipe is confirmed — it is destructive.
if (process.env["WIPE_DB_ON_START"] === "true" && isProduction) {
  logger.error("WIPE_DB_ON_START is forbidden in production — aborting startup");
  process.exit(1);
}
if (process.env["WIPE_DB_ON_START"] === "true") {
  try {
    await wipeDatabase();
  } catch (e) {
    logger.error({ err: e }, "DB wipe failed — aborting startup");
    process.exit(1);
  }
}

// ── Step 2: Unconditional stage seeding ──────────────────────────────────────
// ensureDefaultStages is idempotent and additive — safe to run on every boot
// even when DISABLE_AUTO_SEED=true. This guarantees deal-type stages exist in
// production after a deploy without needing the full super-admin seed to run.
if (runStartupMaintenance) {
  try {
    await ensureDefaultStages();
  } catch (e) {
    logger.error({ err: e }, "Default stage seed failed");
  }
}

// ── Step 3: Notification preferences backfill (idempotent) ───────────────────
// Seeds default prefs (email on, core types on) for every user with no row.
// Users who already have a row — even with everything turned off — are
// untouched. Safe to run on every boot; no-ops once all users are covered.
if (runStartupMaintenance) {
  try {
    await backfillDefaultNotificationPrefs();
  } catch (e) {
    logger.error({ err: e }, "Notification prefs backfill failed");
  }
}

// ── Step 4: Lead follow-up date reconciliation (idempotent) ─────────────────
// Repairs historical rows created before next_follow_up_at was synchronized.
// This never modifies the lead's immutable created_at value.
if (runStartupMaintenance) {
  try {
    await reconcileLeadFollowupDates();
  } catch (e) {
    logger.error({ err: e }, "Lead follow-up date reconciliation failed — aborting startup");
    process.exit(1);
  }
} else {
  logger.info("Startup data maintenance disabled in production");
}

// ── Step 5: Optional auto-seed ───────────────────────────────────────────────
// Both seeders are gated behind DISABLE_AUTO_SEED.
// Development workflow sets this to prevent re-seeding after a manual wipe.
// Production artifact.toml sets this permanently so restarts are idempotent.
const autoSeedDisabled = isProduction || process.env["DISABLE_AUTO_SEED"] === "true";

if (!autoSeedDisabled) {
  // Run critical startup seed BEFORE binding the port so no request can
  // arrive during the delete-then-reinsert window inside ensureGlobalRoles.
  try {
    await seedSuperAdmin();
  } catch (e) {
    logger.error({ err: e }, "Super-admin seed failed");
  }
} else {
  logger.info("Auto-seed disabled (DISABLE_AUTO_SEED=true) — skipping seedSuperAdmin");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  if (!autoSeedDisabled) {
    // Seed demo leads + stages + tags into production if DB is empty
    seedProductionData().catch((e) => logger.error({ err: e }, "Production data seed failed"));
  }

  // Sync Finance role permissions for all existing workspaces (idempotent)
  if (runStartupMaintenance) {
    resyncFinanceRole().catch((e) => logger.error({ err: e }, "resyncFinanceRole failed"));
  }

  // Start the server-side follow-up reminder cron job (runs every 2 min,
  // independent of whether any browser tab has the CRM open).
  startFollowupReminderJob();

  const emailFrom = process.env.EMAIL_FROM;
  const resendConfigured = !!process.env.RESEND_API_KEY;
  if (resendConfigured && emailFrom) {
    const isSandbox = emailFrom === "onboarding@resend.dev";
    if (isSandbox) {
      logger.warn(
        { from: emailFrom },
        "Email delivery in SANDBOX mode — emails only reach the Resend account owner, not leads. Set EMAIL_FROM to a verified domain address to enable real delivery.",
      );
    } else {
      logger.info({ from: emailFrom }, "Email delivery configured via Resend");
    }
  } else if (resendConfigured && !emailFrom) {
    logger.warn(
      { from: "Rapport <onboarding@resend.dev>" },
      "RESEND_API_KEY set but EMAIL_FROM not configured — using default sender",
    );
  } else {
    logger.warn("Email delivery not configured — RESEND_API_KEY missing, emails will be logged only");
  }
});
