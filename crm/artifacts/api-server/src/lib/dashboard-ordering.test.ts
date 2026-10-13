import { describe, expect, it } from "vitest";
import { chronologicalMonths, newestFollowupsFirst } from "./dashboard-ordering";

describe("dashboard ordering", () => {
  it("sorts actual timestamps descending, retaining each follow-up once", () => {
    const rows = [
      { id: 1, scheduledAt: new Date("2026-08-30T20:00:00Z") },
      { id: 2, scheduledAt: new Date("2026-09-01T00:00:00Z") },
      { id: 3, scheduledAt: new Date("2026-08-31T18:30:00Z") },
    ];
    expect(newestFollowupsFirst(rows).map(r => r.id)).toEqual([2, 3, 1]);
    expect(rows.map(r => r.id)).toEqual([1, 2, 3]);
  });
  it("orders by numeric year and month without detaching counts", () => {
    const rows = [
      { year: 2027, monthNumber: 1, month: "Jan", created: 5 },
      { year: 2026, monthNumber: 12, month: "Dec", created: 8 },
      { year: 2026, monthNumber: 2, month: "Feb", created: 3 },
    ];
    expect(chronologicalMonths(rows).map(r => r.created)).toEqual([3, 8, 5]);
  });
});