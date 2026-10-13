/**
 * Lightweight startup migrations.
 *
 * Each entry is idempotent SQL (IF NOT EXISTS / IF EXISTS guards).
 * Add new migrations to the bottom of the list; never remove old ones.
 * Runs before the seed on every server start — safe for both dev and prod.
 */
import { pool } from "@workspace/db";

const MIGRATIONS: { label: string; sql: string }[] = [
  {
    label: "stages: add type column (lead | deal)",
    sql: `ALTER TABLE stages ADD COLUMN IF NOT EXISTS type VARCHAR(10) NOT NULL DEFAULT 'lead'`,
  },
  {
    label: "deal_revenue_entries: backfill initial values for deals converted from leads",
    sql: `
      INSERT INTO deal_revenue_entries
        (deal_id, amount, month, note, created_by_id, workspace_id, created_at, updated_at)
      SELECT
        d.id,
        d.value,
        date_trunc('month', d.created_at)::date,
        'Initial deal value from lead conversion',
        d.created_by_id,
        d.workspace_id,
        NOW(),
        NOW()
      FROM deals d
      WHERE d.value IS NOT NULL
        AND d.value > 0
        AND NOT EXISTS (
          SELECT 1 FROM deal_revenue_entries dre WHERE dre.deal_id = d.id
        )
    `,
  },
  {
    label: "deal stages: rename Active→Ongoing, Won→Closed, Lost→Dropped",
    sql: `
      UPDATE stages SET name='Ongoing' WHERE name='Active' AND type='deal';
      UPDATE stages SET name='Closed'  WHERE name='Won'    AND type='deal';
      UPDATE stages SET name='Dropped' WHERE name='Lost'   AND type='deal'
    `,
  },
  {
    label: "lead channels: add LinkedIn and Database",
    sql: `
      ALTER TYPE lead_channel ADD VALUE IF NOT EXISTS 'linkedin';
      ALTER TYPE lead_channel ADD VALUE IF NOT EXISTS 'database'
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const m of MIGRATIONS) {
      // Strip single-line comments first (some comments contain semicolons),
      // then split on semicolons so each statement is sent individually —
      // pg's client.query() with a multi-statement string can silently skip
      // later statements on some protocol paths.
      const stripped = m.sql.replace(/--[^\n]*/g, "");
      const statements = stripped
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        const res = await client.query(stmt);
        console.log(`[migration]   stmt rows affected: ${res.rowCount ?? "n/a"}`);
      }
      console.log(`[migration] ✓ ${m.label}`);
    }
  } finally {
    client.release();
  }
}
