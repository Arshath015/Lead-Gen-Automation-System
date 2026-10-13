import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHeaders, matchHeaderToCanonicalField, normalizeHeaderText, isSupportedFileName } from "./schema";

test("matchHeaderToCanonicalField: exact canonical labels match", () => {
  assert.equal(matchHeaderToCanonicalField("Company"), "company");
  assert.equal(matchHeaderToCanonicalField("Contact Name"), "contactName");
  assert.equal(matchHeaderToCanonicalField("Designation"), "designation");
  assert.equal(matchHeaderToCanonicalField("Role Category"), "roleCategory");
  assert.equal(matchHeaderToCanonicalField("Email"), "email");
  assert.equal(matchHeaderToCanonicalField("Mobile / Phone"), "phone");
  assert.equal(matchHeaderToCanonicalField("City"), "city");
  assert.equal(matchHeaderToCanonicalField("State"), "state");
  assert.equal(matchHeaderToCanonicalField("Industry"), "industry");
  assert.equal(matchHeaderToCanonicalField("Source File"), "sourceFile");
});

test("matchHeaderToCanonicalField: known aliases match, case/whitespace-insensitively", () => {
  assert.equal(matchHeaderToCanonicalField("  full NAME  "), "contactName");
  assert.equal(matchHeaderToCanonicalField("Job Title"), "designation");
  assert.equal(matchHeaderToCanonicalField("mobile/phone"), "phone");
  assert.equal(matchHeaderToCanonicalField("Mobile   /   Phone"), "phone");
  assert.equal(matchHeaderToCanonicalField("Phone Number"), "phone");
  assert.equal(matchHeaderToCanonicalField("E-mail"), "email");
  assert.equal(matchHeaderToCanonicalField("Organization"), "company");
});

test("matchHeaderToCanonicalField: unrecognized or ambiguous headers are never guessed", () => {
  assert.equal(matchHeaderToCanonicalField("Notes"), null);
  assert.equal(matchHeaderToCanonicalField("LinkedIn"), null);
  assert.equal(matchHeaderToCanonicalField(""), null);
  assert.equal(matchHeaderToCanonicalField("Contact"), "contactName"); // known alias, not a guess
  assert.equal(matchHeaderToCanonicalField("Details"), null);
});

test("normalizeHeaderText: collapses whitespace and slash-spacing variants identically", () => {
  assert.equal(normalizeHeaderText("Mobile / Phone"), normalizeHeaderText("Mobile/Phone"));
  assert.equal(normalizeHeaderText("  Contact   Name "), "contact name");
});

test("analyzeHeaders: a perfectly matching header row (the real master workbook's) has no missing/unmapped fields", () => {
  const headers = ["Company", "Contact Name", "Designation", "Role Category", "Email", "Mobile / Phone", "City", "State", "Industry", "Source File"];
  const analysis = analyzeHeaders(headers);
  assert.deepEqual(analysis.missingFields, []);
  assert.deepEqual(analysis.unmappedColumns, []);
  assert.deepEqual(analysis.duplicateHeaders, []);
  assert.equal(analysis.suggestedMapping.company, 0);
  assert.equal(analysis.suggestedMapping.contactName, 1);
  assert.equal(analysis.suggestedMapping.phone, 5);
  assert.equal(analysis.suggestedMapping.sourceFile, 9);
});

test("analyzeHeaders: reports a missing canonical column when no header matches it", () => {
  const headers = ["Company", "Contact Name", "Email"];
  const analysis = analyzeHeaders(headers);
  assert.ok(analysis.missingFields.includes("phone"));
  assert.ok(analysis.missingFields.includes("city"));
  assert.ok(!analysis.missingFields.includes("company"));
});

test("analyzeHeaders: reports extra/unmapped columns that don't match any canonical field", () => {
  const headers = ["Company", "Contact Name", "LinkedIn URL", "Notes"];
  const analysis = analyzeHeaders(headers);
  const unmappedHeaders = analysis.unmappedColumns.map((c) => c.header);
  assert.ok(unmappedHeaders.includes("LinkedIn URL"));
  assert.ok(unmappedHeaders.includes("Notes"));
});

test("analyzeHeaders: reports duplicate headers with every column index they occur at", () => {
  const headers = ["Company", "Email", "Email", "Contact Name"];
  const analysis = analyzeHeaders(headers);
  assert.equal(analysis.duplicateHeaders.length, 1);
  assert.equal(analysis.duplicateHeaders[0].header, "email");
  assert.deepEqual(analysis.duplicateHeaders[0].indexes, [1, 2]);
  // Auto-suggestion still resolves unambiguously to the first occurrence.
  assert.equal(analysis.suggestedMapping.email, 1);
});

test("analyzeHeaders: blank header cells are ignored, not reported as unmapped columns", () => {
  const headers = ["Company", "", "Contact Name", "   "];
  const analysis = analyzeHeaders(headers);
  assert.deepEqual(analysis.unmappedColumns, []);
});

test("isSupportedFileName: accepts xlsx/csv, rejects legacy .xls and everything else", () => {
  assert.equal(isSupportedFileName("Master Contact Database.xlsx"), true);
  assert.equal(isSupportedFileName("leads.CSV"), true);
  assert.equal(isSupportedFileName("old.xls"), false, "exceljs cannot read legacy binary .xls — reject explicitly rather than fail mid-parse");
  assert.equal(isSupportedFileName("leads.txt"), false);
  assert.equal(isSupportedFileName("leads.json"), false);
  assert.equal(isSupportedFileName("leads.xlsx.exe"), false);
});
