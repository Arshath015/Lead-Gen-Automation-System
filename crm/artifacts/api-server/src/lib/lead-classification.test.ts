import { describe, expect, it } from "vitest";
import { getLeadClassificationDate } from "./lead-classification";

describe("getLeadClassificationDate", () => {
  const originalOutreachDate = new Date("2026-07-29T09:00:00.000Z");

  it("classifies an old lead in the current week when it has a current-week follow-up", () => {
    const currentWeekFollowup = new Date("2026-08-29T09:00:00.000Z");
    const lead = {
      createdAt: originalOutreachDate,
      nextFollowUpAt: currentWeekFollowup,
    } as Parameters<typeof getLeadClassificationDate>[0];

    expect(getLeadClassificationDate(lead)).toEqual(currentWeekFollowup);
    expect(lead.createdAt).toEqual(originalOutreachDate);
  });

  it("classifies an old lead in a future week when its follow-up is in that week", () => {
    const futureWeekFollowup = new Date("2026-09-05T09:00:00.000Z");

    expect(getLeadClassificationDate({
      createdAt: originalOutreachDate,
      nextFollowUpAt: futureWeekFollowup,
    } as Parameters<typeof getLeadClassificationDate>[0])).toEqual(futureWeekFollowup);
  });

  it("uses a rescheduled follow-up date as the new current classification", () => {
    const rescheduledFollowupDate = new Date("2026-09-03T09:00:00.000Z");

    expect(getLeadClassificationDate({
      createdAt: originalOutreachDate,
      nextFollowUpAt: rescheduledFollowupDate,
    } as Parameters<typeof getLeadClassificationDate>[0])).toEqual(rescheduledFollowupDate);
  });

  it("falls back to the original date after the final follow-up is deleted", () => {
    const leadAfterDelete = {
      createdAt: originalOutreachDate,
      nextFollowUpAt: null,
    } as Parameters<typeof getLeadClassificationDate>[0];

    expect(getLeadClassificationDate(leadAfterDelete)).toEqual(originalOutreachDate);
    expect(leadAfterDelete.createdAt).toEqual(originalOutreachDate);
  });
});