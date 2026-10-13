export type DueFollowup = { leadId: number; scheduledAt: Date; status: string };

/** Non-pending follow-ups are history, never due work. */
export function activeFollowups<T extends DueFollowup>(rows: T[], from?: Date): T[] {
  return rows.filter(row => row.status === "pending" && (!from || row.scheduledAt >= from));
}

export function followupDueCounts(rows: DueFollowup[], now: Date, todayEnd: Date, weekEnd: Date) {
  const pending = activeFollowups(rows);
  return {
    overdue: new Set(pending.filter(row => row.scheduledAt < now).map(row => row.leadId)).size,
    dueToday: new Set(pending.filter(row => row.scheduledAt >= now && row.scheduledAt <= todayEnd).map(row => row.leadId)).size,
    dueThisWeek: new Set(pending.filter(row => row.scheduledAt > todayEnd && row.scheduledAt <= weekEnd).map(row => row.leadId)).size,
  };
}