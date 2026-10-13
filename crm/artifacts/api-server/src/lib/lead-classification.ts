import { leadsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

type LeadClassificationFields = Pick<
  typeof leadsTable.$inferSelect,
  "createdAt" | "nextFollowUpAt"
>;

/**
 * A lead stays in its original created-date bucket until a follow-up is
 * scheduled. Scheduled follow-ups take precedence for its current week/date
 * classification without ever changing the original timestamp.
 */
export function getLeadClassificationDate(lead: LeadClassificationFields): Date {
  return lead.nextFollowUpAt ?? lead.createdAt;
}

/** SQL equivalent of getLeadClassificationDate for dashboard aggregations. */
export const leadClassificationDateSql = sql<Date>`
  coalesce(${leadsTable.nextFollowUpAt}, ${leadsTable.createdAt})
`;