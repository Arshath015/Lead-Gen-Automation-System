import type { CanonicalField } from "./schema";

// Text already extracted from whatever cell shape the source file used
// (plain string, number, rich text, hyperlink, formula result — see
// parseWorkbook.ts's readCellText) for every canonical field this row's
// column mapping resolved. A field the user chose to leave blank, or that
// had no data in this particular row, is null.
export interface RawCanonicalRow {
  company: string | null;
  contactName: string | null;
  designation: string | null;
  roleCategory: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  sourceFile: string | null;
}

export interface NormalizedRowFields {
  company: string | null;
  fullName: string | null; // null only when genuinely unusable — the row is then invalid, see RowValidationResult
  title: string | null; // from Designation
  roleCategory: string | null;
  email: string | null; // preserved as-given (trimmed) even when emailValid is false — never dropped or rewritten
  emailValid: boolean;
  phone: string | null; // whitespace-normalized only — no country-code guessing or digit-stripping (source data disagrees on this even for the same person)
  location: string | null; // "City, State" — same join convention as the Apollo adapter's city/state/country
  city: string | null;
  state: string | null;
  industry: string | null;
  sourceFile: string | null;
}

export interface RowValidationResult {
  fields: NormalizedRowFields;
  valid: boolean; // false = cannot become a Lead at all (Lead.fullName is non-nullable)
  invalidReason: string | null;
  // Canonical fields that ended up blank for this specific row — informational,
  // never blocks the import by itself (a lead with no phone is still a lead).
  blankFields: CanonicalField[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Collapses internal whitespace runs only — deliberately does not strip,
// reformat, or add country-code digits. The master workbook itself stores
// the same person's number both with and without a "91" prefix depending on
// which role sheet it came from; guessing which is "correct" would be
// inventing data we don't actually have.
function normalizePhone(value: string | null): string | null {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ");
}

function normalizeEmail(value: string | null): { email: string | null; emailValid: boolean } {
  const trimmed = trimOrNull(value);
  if (!trimmed) return { email: null, emailValid: true }; // absent isn't invalid, just missing
  const valid = EMAIL_RE.test(trimmed);
  // Lowercased only when it looks like a real address (matches computeDedupKey's
  // own email.toLowerCase(), so the dedup key this row will produce is
  // consistent with what gets stored). An invalid-looking value is kept
  // exactly as given — lowercasing garbage doesn't make it more correct.
  return { email: valid ? trimmed.toLowerCase() : trimmed, emailValid: valid };
}

export function normalizeRow(raw: RawCanonicalRow): RowValidationResult {
  const company = trimOrNull(raw.company);
  const fullName = trimOrNull(raw.contactName);
  const title = trimOrNull(raw.designation);
  const roleCategory = trimOrNull(raw.roleCategory);
  const { email, emailValid } = normalizeEmail(raw.email);
  const phone = normalizePhone(raw.phone);
  const city = trimOrNull(raw.city);
  const state = trimOrNull(raw.state);
  const industry = trimOrNull(raw.industry);
  const sourceFile = trimOrNull(raw.sourceFile);
  const location = [city, state].filter(Boolean).join(", ") || null;

  const fields: NormalizedRowFields = {
    company,
    fullName,
    title,
    roleCategory,
    email,
    emailValid,
    phone,
    location,
    city,
    state,
    industry,
    sourceFile,
  };

  const blankFields = (
    [
      ["company", company],
      ["contactName", fullName],
      ["designation", title],
      ["roleCategory", roleCategory],
      ["email", email],
      ["phone", phone],
      ["city", city],
      ["state", state],
      ["industry", industry],
      ["sourceFile", sourceFile],
    ] as [CanonicalField, string | null][]
  )
    .filter(([, value]) => value === null)
    .map(([key]) => key);

  if (!fullName) {
    return { fields, valid: false, invalidReason: "Missing contact name", blankFields };
  }
  return { fields, valid: true, invalidReason: null, blankFields };
}
