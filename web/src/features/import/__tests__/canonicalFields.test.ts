import { describe, expect, it } from "vitest";
import { isLikelyNonContactSheet } from "../canonicalFields";
import type { CanonicalField } from "../../../types";

const ALL_FIELDS: CanonicalField[] = [
  "company",
  "contactName",
  "designation",
  "roleCategory",
  "email",
  "phone",
  "city",
  "state",
  "industry",
  "sourceFile",
];

describe("isLikelyNonContactSheet", () => {
  // Regression: the real production "Master Summary" rollup sheet from
  // Master Contact Database.xlsx — headers are "Sheet Name", "Role(s)",
  // "Records", "With Email", "With Mobile/Phone", "Unique Companies", "With
  // Industry Tag", "Source File". Only "Source File" alias-matches a
  // canonical field (sourceFile, optional tier), so missingFields is 9 of
  // 10 — the OLD "every field missing" check would have failed to exclude
  // this sheet. It must still be treated as non-contact because none of the
  // three CORE fields (company/contactName/email) matched.
  it("excludes the real Master Contact Database.xlsx Master Summary sheet despite one coincidental optional-field match", () => {
    const missingFields: CanonicalField[] = ["company", "contactName", "designation", "roleCategory", "email", "phone", "city", "state", "industry"];
    expect(isLikelyNonContactSheet(missingFields)).toBe(true);
  });

  // Regression: the dummy QA workbook's "Master Summary" sheet — zero fields
  // matched at all (missing all 10). Must still be excluded under the new logic.
  it("excludes a sheet with zero fields matched at all (the dummy QA workbook's Master Summary)", () => {
    expect(isLikelyNonContactSheet(ALL_FIELDS)).toBe(true);
  });

  it("does not exclude a fully-mapped genuine data sheet (zero missing fields)", () => {
    expect(isLikelyNonContactSheet([])).toBe(false);
  });

  it("does not exclude a genuine data sheet missing only optional fields, with all three core fields present", () => {
    const missingFields: CanonicalField[] = ["designation", "roleCategory", "phone", "city", "state", "industry", "sourceFile"];
    expect(isLikelyNonContactSheet(missingFields)).toBe(false);
  });

  it("does not exclude a sparse data sheet missing two of three core fields, as long as one core field matched", () => {
    // Only "email" was detected (company/contactName weren't) — still has a
    // plausible per-row identity column, so it's left as a normal mapping
    // card rather than auto-excluded.
    const missingFields: CanonicalField[] = ["company", "contactName", "designation", "roleCategory", "phone", "city", "state", "industry", "sourceFile"];
    expect(isLikelyNonContactSheet(missingFields)).toBe(false);
  });

  it("excludes a sheet missing all three core fields even if every optional field matched", () => {
    const missingFields: CanonicalField[] = ["company", "contactName", "email"];
    expect(isLikelyNonContactSheet(missingFields)).toBe(true);
  });
});
