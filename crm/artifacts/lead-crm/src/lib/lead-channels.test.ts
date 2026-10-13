import { describe, expect, it } from "vitest";
import { LEAD_CHANNEL_LABELS } from "./lead-channels";

describe("lead channel dropdown contract", () => {
  it.each([
    ["website", "Website"],
    ["linkedin", "LinkedIn"],
    ["database", "Database"],
    ["apollo", "Apollo"],
  ] as const)("accepts %s and preserves the %s display label", (value, label) => {
    expect(LEAD_CHANNEL_LABELS[value]).toBe(label);
  });

  it("keeps LinkedIn and Database as distinct API values", () => {
    expect(Object.keys(LEAD_CHANNEL_LABELS)).toEqual(
      expect.arrayContaining(["linkedin", "database"]),
    );
  });
});