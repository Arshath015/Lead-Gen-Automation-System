import { describe, expect, it } from "vitest";
import { filterLeadsByIndustry } from "./lead-industry-filter";

const rows = [
  { lead: { id: 1, industry: "Fintech", stageId: 1 } },
  { lead: { id: 2, industry: "Others", stageId: 2 } },
  { lead: { id: 3, industry: "FinTech", stageId: 2 } },
  { lead: { id: 4, industry: "SaaS", stageId: 1 } },
  { lead: { id: 5, industry: null, stageId: 2 } },
  { lead: { id: 6, industry: "Telecom", stageId: 1 } },
  { lead: { id: 7, industry: "Telecommunications", stageId: 1 } },
  { lead: { id: 8, industry: "Healthcare & Wellness", stageId: 2 } },
  { lead: { id: 9, industry: "Pharmaceutical", stageId: 1 } },
];

describe("lead industry filtering", () => {
  it("combines multiple industries with OR matching, preserving case-insensitive exact matches", () => {
    const candidates = [
      { lead: { id: 1, industry: "Manufacturing" } },
      { lead: { id: 2, industry: "engineering" } },
      { lead: { id: 3, industry: "IT Services & Consulting" } },
      { lead: { id: 4, industry: "Engineering legacy" } },
      { lead: { id: 5, industry: "Fintech" } },
      { lead: { id: 6, industry: null } },
    ];
    const before = structuredClone(candidates);
    const query = JSON.stringify(["Manufacturing", "Engineering", "IT Services & Consulting"]);
    expect(filterLeadsByIndustry(candidates, query).map(row => row.lead.id)).toEqual([1, 2, 3]);
    expect(filterLeadsByIndustry(candidates, "")).toEqual(candidates);
    expect(filterLeadsByIndustry(candidates, "[]")).toEqual(candidates);
    expect(candidates).toEqual(before);
  });

  it("preserves legacy values and supports them alongside standardized choices", () => {
    expect(filterLeadsByIndustry(rows, JSON.stringify(["SaaS", "Telecom", "Fintech"])).map(row => row.lead.id))
      .toEqual([1, 3, 4, 6]);
    const commaRows = [{ lead: { industry: "Legacy, Custom" } }];
    expect(filterLeadsByIndustry(commaRows, JSON.stringify(["Manufacturing", "Legacy, Custom"]))).toEqual(commaRows);
    expect(filterLeadsByIndustry(commaRows, "Legacy, Custom")).toEqual(commaRows);
  });

  it.each([
    "IT Services & Consulting", "Engineering", "Automotive",
    "Retail & FMCG", "E-Commerce", "Manufacturing",
  ])("matches %s exactly and case-insensitively without changing stored values", industry => {
    const candidates = [
      { lead: { id: 1, industry } },
      { lead: { id: 2, industry: industry.toLowerCase() } },
      { lead: { id: 3, industry: `${industry} legacy` } },
      { lead: { id: 4, industry: null } },
    ];
    const before = structuredClone(candidates);
    expect(filterLeadsByIndustry(candidates, industry).map(row => row.lead.id)).toEqual([1, 2]);
    expect(filterLeadsByIndustry(candidates, `${industry} legacy`).map(row => row.lead.id)).toEqual([3]);
    expect(candidates).toEqual(before);
  });

  it("matches Fintech exactly, case-insensitively, without matching unrelated industries", () => {
    expect(filterLeadsByIndustry(rows, "Fintech").map(row => row.lead.id)).toEqual([1, 3]);
    expect(filterLeadsByIndustry(rows, "Others").map(row => row.lead.id)).toEqual([2]);
    expect(filterLeadsByIndustry(rows, "SaaS").map(row => row.lead.id)).toEqual([4]);
    expect(filterLeadsByIndustry(rows, "Telecommunications").map(row => row.lead.id)).toEqual([7]);
    expect(filterLeadsByIndustry(rows, "Telecom").map(row => row.lead.id)).toEqual([6]);
    expect(filterLeadsByIndustry(rows, "Healthcare & Wellness").map(row => row.lead.id)).toEqual([8]);
    expect(filterLeadsByIndustry(rows, "Pharmaceutical").map(row => row.lead.id)).toEqual([9]);
  });

  it("combines with existing scope/stage filters before counting and pagination", () => {
    const scoped = rows.filter(row => row.lead.stageId === 2);
    expect(filterLeadsByIndustry(scoped, "Fintech").map(row => row.lead.id)).toEqual([3]);
    expect(filterLeadsByIndustry(scoped, undefined)).toEqual(scoped);
  });
});