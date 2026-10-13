import { describe, expect, it } from "vitest";
import { isStageTransition, lostActivityMarker } from "./lost-lead-rules";

describe("Lost transitions", () => {
  it("does not record an activity when the lead is already in the requested stage", () => {
    expect(isStageTransition(7, 7)).toBe(false);
  });
  it("records both entries to Lost after leaving it, with a stable marker", () => {
    expect(isStageTransition(3, 7)).toBe(true);
    expect(lostActivityMarker(true, "Closed Lost")).toBe("Lost");
    expect(isStageTransition(7, 3)).toBe(true);
    expect(isStageTransition(3, 7)).toBe(true);
    expect(lostActivityMarker(false, "Qualified")).toBe("Qualified");
  });
});