import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export type LeadFollowupDateRepair = {
  id: number;
  previousNextFollowUpAt: Date | null;
  nextFollowUpAt: Date | null;
};

/**
 * Reconciles the denormalized lead classification date with the most recently
 * updated pending follow-up. This is intentionally idempotent and leaves the
 * lead's immutable created_at value untouched.
 */
export async function reconcileLeadFollowupDates(): Promise<LeadFollowupDateRepair[]> {
  const result = await db.execute<{
    id: number;
    previous_next_follow_up_at: Date | null;
    next_follow_up_at: Date | null;
  }>(sql`
    WITH desired AS (
      SELECT
        l.id,
        l.next_follow_up_at AS previous_next_follow_up_at,
        (
          SELECT f.scheduled_at
          FROM followups f
          WHERE f.lead_id = l.id
            AND f.status = 'pending'
          ORDER BY f.updated_at DESC, f.id DESC
          LIMIT 1
        ) AS desired_next_follow_up_at
      FROM leads l
    ),
    repaired AS (
      UPDATE leads l
      SET next_follow_up_at = desired.desired_next_follow_up_at
      FROM desired
      WHERE l.id = desired.id
        AND l.next_follow_up_at IS DISTINCT FROM desired.desired_next_follow_up_at
      RETURNING
        l.id,
        desired.previous_next_follow_up_at,
        l.next_follow_up_at
    )
    SELECT id, previous_next_follow_up_at, next_follow_up_at
    FROM repaired
    ORDER BY id
  `);

  const repairs = result.rows.map((row) => ({
    id: Number(row.id),
    previousNextFollowUpAt: row.previous_next_follow_up_at,
    nextFollowUpAt: row.next_follow_up_at,
  }));

  if (repairs.length > 0) {
    logger.info(
      { repairedLeadCount: repairs.length },
      "[lead-followup-dates] reconciled lead classification dates",
    );
  } else {
    logger.info(
      "[lead-followup-dates] all lead classification dates already match pending follow-ups",
    );
  }

  return repairs;
}