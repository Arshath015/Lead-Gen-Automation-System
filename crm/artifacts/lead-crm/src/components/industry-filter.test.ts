import { describe, expect, it } from "vitest";
import { INDUSTRIES } from "./industry-select";
import { industryFilterOptions } from "./industry-filter";
import {
  decodeIndustrySelection, encodeIndustrySelection, toggleIndustrySelection,
} from "@/lib/industry-filter-selection";

describe("Industry multi-select filter", () => {
  it("contains every standardized option once, including Manufacturing", () => {
    expect(industryFilterOptions([])).toEqual(INDUSTRIES);
    expect(new Set(industryFilterOptions([])).size).toBe(16);
  });

  it("retains selections independently of the visible scroll window", () => {
    let selected: string[] = [];
    for (const industry of ["Manufacturing", "Engineering", "IT Services & Consulting"]) {
      selected = toggleIndustrySelection(selected, industry);
    }
    expect(decodeIndustrySelection(encodeIndustrySelection(selected))).toEqual([
      "Manufacturing", "Engineering", "IT Services & Consulting",
    ]);
    expect(industryFilterOptions(selected)).toEqual(INDUSTRIES);
    expect(toggleIndustrySelection(selected, "Engineering")).toEqual([
      "Manufacturing", "IT Services & Consulting",
    ]);
  });

  it("All Industries clears selection and preserves old single-industry links", () => {
    expect(encodeIndustrySelection([])).toBe("");
    expect(decodeIndustrySelection("")).toEqual([]);
    expect(decodeIndustrySelection("Manufacturing")).toEqual(["Manufacturing"]);
  });

  it("preserves exact legacy strings, casing, and names containing commas", () => {
    const legacy = ["FinTech", "Legacy, Custom", '["Legacy"]'];
    expect(decodeIndustrySelection(encodeIndustrySelection(legacy))).toEqual(legacy);
    expect(decodeIndustrySelection(encodeIndustrySelection(['["Legacy"]']))).toEqual(['["Legacy"]']);
    expect(industryFilterOptions(legacy)).toEqual([...INDUSTRIES, ...legacy]);
    expect(decodeIndustrySelection("[unstructured legacy]")).toEqual(["[unstructured legacy]"]);
  });
});