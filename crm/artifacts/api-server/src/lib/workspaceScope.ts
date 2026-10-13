import { eq, isNull, and, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * Returns a Drizzle WHERE condition scoping a query to the current workspace.
 *
 * SECURITY: workspaceId MUST always come from req.user.workspaceId (session-derived).
 * Never pass a value from client input (body, query params, URL params) here.
 *
 * - wid !== null → eq(column, wid)   (workspace user — only their data)
 * - wid === null → isNull(column)    (legacy single-org user — legacy data)
 */
export function wsFilter(column: AnyColumn, wid: number | null | undefined): SQL {
  return wid != null ? eq(column, wid) : isNull(column);
}

/**
 * Combines workspace filter with additional conditions using AND.
 */
export function wsAnd(column: AnyColumn, wid: number | null | undefined, ...conditions: (SQL | undefined)[]): SQL {
  const wsCond = wsFilter(column, wid);
  const extras = conditions.filter((c): c is SQL => c !== undefined);
  if (extras.length === 0) return wsCond;
  return and(wsCond, ...extras) as SQL;
}
