/**
 * resetDevelopmentDatabase — wipes ALL rows from every application table in
 * the current database (TRUNCATE ... RESTART IDENTITY CASCADE), leaving the
 * schema, indexes, constraints, and migrations untouched.
 *
 * SAFETY:
 *  - Refuses to run when NODE_ENV === "production".
 *  - Refuses to run unless the caller explicitly opts in with
 *    CONFIRM_DB_RESET=yes (belt-and-suspenders against accidental invocation
 *    from a script, cron, or copy-pasted command).
 *  - Refuses to run if DATABASE_URL looks like a hosted/production database
 *    (heuristic hostname check) unless ALLOW_NON_DEV_HOST=yes is also set.
 *
 * After truncation, the app is left exactly like a fresh install: the
 * `/api/auth/setup-needed` endpoint reports `needsSetup: true` because
 * usersTable is empty, and the onboarding wizard (POST /api/workspaces or
 * /api/auth/setup) will recreate a workspace + stages + roles + admin user
 * on demand. No seed rows are required for the app to function, so none are
 * inserted here — this matches "fresh installation" behavior exactly.
 *
 * Usage:
 *   pnpm db:reset-dev
 *   (equivalent to: CONFIRM_DB_RESET=yes tsx scripts/src/reset-dev-db.ts)
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function assertDevelopmentEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[reset-dev-db] Refusing to run: NODE_ENV is 'production'. " +
      "This script is for development databases only.",
    );
  }

  if (process.env.CONFIRM_DB_RESET !== "yes") {
    throw new Error(
      "[reset-dev-db] Refusing to run without explicit confirmation. " +
      "Re-run via `pnpm db:reset-dev`, which sets CONFIRM_DB_RESET=yes for you.",
    );
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  const looksLikeProdHost = /\b(prod|production)\b/i.test(dbUrl);
  if (looksLikeProdHost && process.env.ALLOW_NON_DEV_HOST !== "yes") {
    throw new Error(
      "[reset-dev-db] Refusing to run: DATABASE_URL hostname looks like a " +
      "production database. If this is truly a dev/test database with a " +
      "misleading name, re-run with ALLOW_NON_DEV_HOST=yes.",
    );
  }
}

async function getApplicationTables(): Promise<string[]> {
  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  `);
  return result.rows.map((r) => r.tablename);
}

async function resetDevelopmentDatabase() {
  assertDevelopmentEnvironment();

  console.log("[reset-dev-db] Confirmed development environment. Proceeding…");

  const tables = await getApplicationTables();
  if (tables.length === 0) {
    console.log("[reset-dev-db] No tables found in 'public' schema. Nothing to do.");
    return;
  }

  console.log(`[reset-dev-db] Found ${tables.length} table(s):`);
  for (const t of tables) console.log(`  - ${t}`);

  const quoted = tables.map((t) => `"${t}"`).join(", ");

  console.log("\n[reset-dev-db] Truncating all tables with RESTART IDENTITY CASCADE…");
  // A single statement lets Postgres resolve FK ordering itself — no need to
  // hand-order deletes or temporarily drop constraints.
  await db.execute(sql.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`));

  console.log("[reset-dev-db] All application tables truncated and sequences reset.");
  console.log(
    "[reset-dev-db] No seed rows inserted — the app self-bootstraps on first " +
    "use via the onboarding wizard (POST /api/workspaces or /api/auth/setup), " +
    "exactly like a fresh installation.",
  );
  console.log(
    "\n[reset-dev-db] NOTE: if SUPERADMIN_INITIAL_PASSWORD is set, the API " +
    "server will recreate a global super-admin user on its next restart " +
    "(seedSuperAdmin runs automatically at startup whenever usersTable is " +
    "empty). Likewise, seedProductionData() will re-insert demo leads on " +
    "restart if the leads table has fewer than 10 rows. Restart the API " +
    "server only after you've confirmed this is the behavior you want.",
  );

  console.log("\n✅ Development database reset complete.");
}

resetDevelopmentDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
