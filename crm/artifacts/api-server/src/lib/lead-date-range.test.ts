import { describe, expect, it } from "vitest";
import {
  parseLeadRangeEndExclusive,
  parseLeadRangeStart,
} from "./lead-date-range";

describe("lead classification date ranges", () => {
  it("turns an IST single-day input into a half-open range", () => {
    expect(parseLeadRangeStart("2026-08-31")?.toISOString())
      .toBe("2026-08-30T18:30:00.000Z");
    expect(parseLeadRangeEndExclusive("2026-08-31")?.toISOString())
      .toBe("2026-08-31T18:30:00.000Z");
  });

  it("excludes September follow-ups from the August 31 range", () => {
    const from = parseLeadRangeStart("2026-08-31")!;
    const to = parseLeadRangeEndExclusive("2026-08-31")!;
    const august31 = new Date("2026-08-31T10:00:00.000Z");
    const september1Ist = new Date("2026-08-31T18:30:00.000Z");

    expect(august31 >= from && august31 < to).toBe(true);
    expect(september1Ist >= from && september1Ist < to).toBe(false);
  });

  it("converts the dashboard's inclusive ISO end to the same exclusive boundary", () => {
    expect(parseLeadRangeEndExclusive("2026-08-31T18:29:59.999Z")?.toISOString())
      .toBe("2026-08-31T18:30:00.000Z");
  });
});