import { describe, expect, it } from "vitest";

type PendingFollowup = {
  id: number;
  scheduledAt: Date;
  updatedAt: Date;
};

function desiredNextFollowUpAt(followups: PendingFollowup[]): Date | null {
  const latest = [...followups].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id,
  )[0];
  return latest?.scheduledAt ?? null;
}

describe("lead follow-up date reconciliation policy", () => {
  it("repairs a historical lead whose pending follow-up was never copied to the lead", () => {
    const scheduledAt = new Date("2026-08-28T10:00:00.000Z");

    expect(desiredNextFollowUpAt([{
      id: 8,
      scheduledAt,
      updatedAt: new Date("2026-08-25T08:03:17.000Z"),
    }])).toEqual(scheduledAt);
  });

  it("uses the most recently updated pending follow-up, then the highest id", () => {
    const sameUpdateTime = new Date("2026-08-28T08:00:00.000Z");
    const latestScheduledAt = new Date("2026-09-04T10:00:00.000Z");

    expect(desiredNextFollowUpAt([
      {
        id: 7,
        scheduledAt: new Date("2026-08-28T10:00:00.000Z"),
        updatedAt: sameUpdateTime,
      },
      {
        id: 8,
        scheduledAt: latestScheduledAt,
        updatedAt: sameUpdateTime,
      },
    ])).toEqual(latestScheduledAt);
  });

  it("clears the classification override when no pending follow-up remains", () => {
    expect(desiredNextFollowUpAt([])).toBeNull();
  });
});