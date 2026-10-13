import { describe, expect, it } from "vitest";
import { activeFollowups, followupDueCounts } from "./followup-due";

const now = new Date("2026-09-26T09:00:00Z");
const end = new Date("2026-09-26T23:59:59Z");
const week = new Date("2026-10-03T09:00:00Z");
const rows = [
  { id: 1, leadId: 1, status: "pending", scheduledAt: new Date("2026-09-25T09:00:00Z") },
  { id: 2, leadId: 1, status: "pending", scheduledAt: new Date("2026-09-25T10:00:00Z") },
  { id: 3, leadId: 2, status: "pending", scheduledAt: new Date("2026-09-26T10:00:00Z") },
  { id: 4, leadId: 3, status: "pending", scheduledAt: new Date("2026-09-28T09:00:00Z") },
  { id: 5, leadId: 4, status: "completed", scheduledAt: new Date("2026-09-25T09:00:00Z") },
  { id: 6, leadId: 5, status: "cancelled", scheduledAt: new Date("2026-09-26T10:00:00Z") },
  { id: 7, leadId: 6, status: "missed", scheduledAt: new Date("2026-09-28T09:00:00Z") },
];

describe("active follow-ups due", () => {
  it("retains completed/cancelled records but excludes them from active lists and counts", () => {
    expect(rows).toHaveLength(7);
    expect(activeFollowups(rows).map(row => row.id)).toEqual([1, 2, 3, 4]);
    expect(followupDueCounts(rows, now, end, week)).toEqual({ overdue: 1, dueToday: 1, dueThisWeek: 1 });
  });
  it("honors the existing date window without counting historical statuses", () => {
    expect(activeFollowups(rows, now).map(row => row.id)).toEqual([3, 4]);
  });
});