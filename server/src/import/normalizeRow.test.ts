import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRow, type RawCanonicalRow } from "./normalizeRow";

function rawRow(overrides: Partial<RawCanonicalRow> = {}): RawCanonicalRow {
  return {
    company: null,
    contactName: null,
    designation: null,
    roleCategory: null,
    email: null,
    phone: null,
    city: null,
    state: null,
    industry: null,
    sourceFile: null,
    ...overrides,
  };
}

test("normalizeRow: a fully populated row normalizes cleanly and is valid", () => {
  const result = normalizeRow(
    rawRow({
      company: "  Bharat Bobbins Limited ",
      contactName: " MANISH PATHAK ",
      designation: "Chairman & Managing Director",
      roleCategory: "Chairman",
      email: " Manishcpathak@Gmail.com ",
      phone: " 9413346641 ",
      city: "Ahmedabad",
      state: " Gujarat ",
      industry: "Manufacturing",
      sourceFile: "Company Chairman 14803.xlsx",
    })
  );

  assert.equal(result.valid, true);
  assert.equal(result.invalidReason, null);
  assert.equal(result.fields.company, "Bharat Bobbins Limited");
  assert.equal(result.fields.fullName, "MANISH PATHAK", "original capitalization is preserved, never reformatted");
  assert.equal(result.fields.email, "manishcpathak@gmail.com", "valid email is lowercased for consistent dedup");
  assert.equal(result.fields.emailValid, true);
  assert.equal(result.fields.phone, "9413346641");
  assert.equal(result.fields.location, "Ahmedabad, Gujarat");
  assert.deepEqual(result.blankFields, []);
});

test("normalizeRow: a row with no contact name is invalid and reports why", () => {
  const result = normalizeRow(rawRow({ company: "Acme Corp", email: "a@acme.com" }));
  assert.equal(result.valid, false);
  assert.equal(result.invalidReason, "Missing contact name");
  assert.equal(result.fields.fullName, null);
});

test("normalizeRow: blank/whitespace-only cells normalize to null and are tracked as blank fields", () => {
  const result = normalizeRow(rawRow({ contactName: "Jane Doe", company: "   ", phone: "" }));
  assert.equal(result.valid, true);
  assert.equal(result.fields.company, null);
  assert.equal(result.fields.phone, null);
  assert.ok(result.blankFields.includes("company"));
  assert.ok(result.blankFields.includes("phone"));
  assert.ok(!result.blankFields.includes("contactName"));
});

test("normalizeRow: a malformed email is preserved as-is, flagged invalid, but does not invalidate the row", () => {
  const result = normalizeRow(rawRow({ contactName: "Jane Doe", email: "not-an-email" }));
  assert.equal(result.valid, true, "email format issues never block the row — only a missing name does");
  assert.equal(result.fields.email, "not-an-email", "the original value is preserved, never invented or dropped");
  assert.equal(result.fields.emailValid, false);
});

test("normalizeRow: phone whitespace is collapsed but digits/country-code guessing never happens", () => {
  const withPrefix = normalizeRow(rawRow({ contactName: "A", phone: "  91   9454374665  " }));
  const withoutPrefix = normalizeRow(rawRow({ contactName: "B", phone: "9454374665" }));
  assert.equal(withPrefix.fields.phone, "91 9454374665", "not stripped, not re-added — kept exactly as given, just whitespace-collapsed");
  assert.equal(withoutPrefix.fields.phone, "9454374665");
});

test("normalizeRow: city-only and state-only rows still produce a usable location", () => {
  assert.equal(normalizeRow(rawRow({ contactName: "A", city: "Pune" })).fields.location, "Pune");
  assert.equal(normalizeRow(rawRow({ contactName: "A", state: "Maharashtra" })).fields.location, "Maharashtra");
  assert.equal(normalizeRow(rawRow({ contactName: "A" })).fields.location, null);
});

test("normalizeRow: every canonical field ending up blank is reported, for a row with nothing but a name", () => {
  const result = normalizeRow(rawRow({ contactName: "Solo Name" }));
  assert.equal(result.valid, true);
  const expectedBlank = ["company", "designation", "roleCategory", "email", "phone", "city", "state", "industry", "sourceFile"];
  for (const key of expectedBlank) {
    assert.ok(result.blankFields.includes(key as never), `${key} should be reported blank`);
  }
  assert.equal(result.blankFields.length, expectedBlank.length);
});
