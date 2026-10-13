import { describe, expect, it } from "vitest";
import { stageIdFromBarEvent } from "./pipeline-stage-links";

describe("pipeline bar navigation", () => {
  it("extracts actual stage IDs for all seven default stages, including names with spaces", () => {
    for (const [index, name] of ["New Lead", "Contacted", "Qualified", "Proposal Sent", "Negotiation", "Won", "Lost"].entries()) {
      expect(stageIdFromBarEvent({ payload: { stageId: index + 1, stageName: name } })).toBe(index + 1);
    }
  });
  it("never navigates with undefined or a nonnumeric stage", () => {
    expect(stageIdFromBarEvent({ payload: { stageName: "Lost" } })).toBeNull();
    expect(stageIdFromBarEvent({ stageId: "undefined" })).toBeNull();
  });
});