import { describe, expect, it } from "vitest";
import { getLeadListUrlFilters } from "./lead-list-filters";

describe("getLeadListUrlFilters", () => {
  it("uses the current URL instead of retaining an earlier owner filter", () => {
    expect(getLeadListUrlFilters("?ownerId=3&status=won")).toMatchObject({
      ownerFilter: "3",
      status: "won",
    });

    expect(getLeadListUrlFilters("")).toEqual({
      search: "",
      stageId: "all",
      priority: "all",
      channel: "all",
      tagId: "all",
      ownerFilter: "all",
      location: "",
      industry: "",
      source: "",
      dateFrom: "",
      dateTo: "",
      status: "all",
      unassigned: false,
      missing: "",
      stale: false,
      followupDue: "",
    });
  });

  it("preserves dashboard drill-down filters from the current URL", () => {
    expect(
      getLeadListUrlFilters(
        "?ownerId=4&stageId=9&tagId=12&unassigned=true&stale=true&search=North",
      ),
    ).toMatchObject({
      ownerFilter: "4",
      stageId: "9",
      tagId: "12",
      unassigned: true,
      stale: true,
      search: "North",
    });
  });

  it("keeps Industry with the other filters and clears it when the URL is cleared", () => {
    expect(getLeadListUrlFilters("?industry=BPO+%26+BPM&search=North&stageId=9&ownerId=4")).toMatchObject({
      industry: "BPO & BPM",
      search: "North",
      stageId: "9",
      ownerFilter: "4",
    });
    expect(getLeadListUrlFilters("")).toMatchObject({ industry: "", search: "", stageId: "all" });
  });

  it("retains the multi-industry string in URL navigation without changing other filters", () => {
    const industry = JSON.stringify(["Manufacturing", "Engineering", "IT Services & Consulting"]);
    const params = new URLSearchParams({ industry, stageId: "9" });
    expect(getLeadListUrlFilters(`?${params}`)).toMatchObject({ industry, stageId: "9" });
  });
});