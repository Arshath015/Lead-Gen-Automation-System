import { describe, expect, it } from "vitest";
import { INDUSTRIES, industryOptions } from "./industry-select";

describe("industry choices", () => {
  it("keeps every original choice and adds the client-requested industries", () => {
    expect(INDUSTRIES).toEqual([
      "Fintech", "Manufacturing", "GCC", "BFSI", "Energy",
      "Startups", "Telecommunications", "BPO & BPM",
      "Healthcare & Wellness", "Pharmaceutical", "Others",
      "IT Services & Consulting", "Engineering", "Automotive",
      "Retail & FMCG", "E-Commerce",
    ]);
    expect(industryOptions("")).toEqual(INDUSTRIES);
    expect(new Set(INDUSTRIES).size).toBe(INDUSTRIES.length);
    expect(INDUSTRIES.filter(industry => industry === "Manufacturing")).toHaveLength(1);
  });

  it.each([
    "IT Services & Consulting", "Engineering", "Automotive",
    "Retail & FMCG", "E-Commerce", "Manufacturing",
  ])("includes %s once when selected in any shared form or filter", industry => {
    expect(industryOptions(industry)).toEqual(INDUSTRIES);
    expect(industryOptions(industry).filter(option => option === industry)).toHaveLength(1);
  });

  it("retains an existing industry's original value when editing or following a legacy filter link", () => {
    expect(industryOptions("Telecom")).toEqual([...INDUSTRIES, "Telecom"]);
    expect(industryOptions("SaaS")).toEqual([...INDUSTRIES, "SaaS"]);
    expect(industryOptions("Fintech")).toEqual(INDUSTRIES);
    expect(industryOptions("Telecommunications")).toEqual(INDUSTRIES);
    expect(industryOptions("FinTech")).toEqual([...INDUSTRIES, "FinTech"]);
  });
});