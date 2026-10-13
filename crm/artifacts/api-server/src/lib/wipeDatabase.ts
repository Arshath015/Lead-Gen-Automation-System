import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * wipeDatabase — truncates every application table in the connected database
 * with RESTART IDENTITY CASCADE. Intended for production reset scenarios where
 * the WIPE_DB_ON_START env var is explicitly set by an operator.
 *
 * Unlike the dev reset script this has NO NODE_ENV guard — it is called from
 * index.ts only when WIPE_DB_ON_START=true is explicitly present.
 */
export async function wipeDatabase(): Promise<void> {
  logger.warn("[wipe] WIPE_DB_ON_START=true — truncating all application tables…");

  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);

  const tables = result.rows.map((r) => r.tablename);

  if (tables.length === 0) {
    logger.warn("[wipe] No tables found — nothing to truncate.");
    return;
  }

  logger.warn({ tables }, `[wipe] Found ${tables.length} table(s) — truncating…`);

  const quoted = tables.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`));

  logger.warn("[wipe] All tables truncated and sequences reset. Database is now empty.");
}
