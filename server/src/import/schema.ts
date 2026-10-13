// The canonical import schema every uploaded worksheet/CSV is normalized
// into, regardless of which lead source or master-database role sheet it
// came from. Adding a future source's own header spelling means adding an
// alias below — never a new hardcoded worksheet/file branch anywhere in the
// import pipeline (see importPipeline.ts, which is schema-driven end to end).

export type CanonicalField =
  | "company"
  | "contactName"
  | "designation"
  | "roleCategory"
  | "email"
  | "phone"
  | "city"
  | "state"
  | "industry"
  | "sourceFile";

export interface CanonicalFieldDef {
  key: CanonicalField;
  label: string; // the exact canonical header spelling, e.g. "Mobile / Phone"
  aliases: string[]; // additional header spellings that map to this field, matched case/whitespace-insensitively
  // "core" fields are the ones a usable lead realistically needs (name/email/company);
  // missing them is called out more prominently in the UI, but neither tier ever
  // blocks the import by itself — the user always decides (map/blank/skip/cancel).
  tier: "core" | "optional";
}

export const CANONICAL_FIELDS: CanonicalFieldDef[] = [
  { key: "company", label: "Company", tier: "core", aliases: ["company name", "organisation", "organization", "org", "employer", "account name"] },
  { key: "contactName", label: "Contact Name", tier: "core", aliases: ["full name", "name", "person name", "contact"] },
  { key: "designation", label: "Designation", tier: "optional", aliases: ["title", "job title", "position"] },
  { key: "roleCategory", label: "Role Category", tier: "optional", aliases: ["role", "category", "seniority"] },
  { key: "email", label: "Email", tier: "core", aliases: ["email address", "e-mail", "e mail"] },
  {
    key: "phone",
    label: "Mobile / Phone",
    tier: "optional",
    aliases: ["mobile/phone", "mobile", "phone", "phone number", "mobile number", "contact number", "tel", "telephone"],
  },
  { key: "city", label: "City", tier: "optional", aliases: ["town"] },
  { key: "state", label: "State", tier: "optional", aliases: ["state/region", "region", "province"] },
  { key: "industry", label: "Industry", tier: "optional", aliases: ["industry type", "sector", "industry segment"] },
  { key: "sourceFile", label: "Source File", tier: "optional", aliases: ["source", "file", "source filename"] },
];

const CANONICAL_FIELDS_BY_KEY = new Map(CANONICAL_FIELDS.map((f) => [f.key, f]));

export function getCanonicalFieldDef(key: CanonicalField): CanonicalFieldDef {
  const def = CANONICAL_FIELDS_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown canonical field: ${key}`);
  return def;
}

// Case/whitespace-insensitive, otherwise exact. Collapses internal whitespace
// and normalizes "a / b" / "a/b" / "a  /  b" spacing variants to "a/b" so
// "Mobile / Phone" and "Mobile/Phone" are recognized as the same header
// without treating unrelated near-misses as a match.
export function normalizeHeaderText(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");
}

// Maps ONE detected header string to a canonical field, or null if it isn't
// a recognized exact/alias match. Deliberately does no fuzzy/substring
// matching — an ambiguous or unrecognized header is surfaced to the user for
// an explicit decision rather than silently guessed (see requirement: "Do
// not silently map ambiguous columns").
export function matchHeaderToCanonicalField(header: string): CanonicalField | null {
  const normalized = normalizeHeaderText(header);
  if (!normalized) return null;
  for (const def of CANONICAL_FIELDS) {
    if (normalizeHeaderText(def.label) === normalized) return def.key;
    if (def.aliases.some((a) => normalizeHeaderText(a) === normalized)) return def.key;
  }
  return null;
}

export interface HeaderAnalysis {
  headers: string[]; // raw detected header strings, in column order, "" for a blank header cell
  // Column index (into `headers`) that each canonical field auto-matched to.
  // Absent key = no unambiguous match found in this sheet.
  suggestedMapping: Partial<Record<CanonicalField, number>>;
  // Canonical fields with no header match at all — the user must resolve
  // each of these (map another column / leave blank / skip sheet / cancel).
  missingFields: CanonicalField[];
  // Header columns that didn't match any canonical field.
  unmappedColumns: { index: number; header: string }[];
  // Header text (normalized) that appears more than once among `headers`,
  // with every column index it appears at — the auto-suggested mapping only
  // ever picks the first occurrence, so the user must choose explicitly if
  // ambiguity here is real.
  duplicateHeaders: { header: string; indexes: number[] }[];
}

export function analyzeHeaders(headers: string[]): HeaderAnalysis {
  const suggestedMapping: Partial<Record<CanonicalField, number>> = {};
  const unmappedColumns: { index: number; header: string }[] = [];
  const seenAt = new Map<string, number[]>();

  headers.forEach((header, index) => {
    const trimmed = (header ?? "").trim();
    if (!trimmed) return; // blank header cell — not a real column, not reported as unmapped
    const normalized = normalizeHeaderText(trimmed);
    seenAt.set(normalized, [...(seenAt.get(normalized) ?? []), index]);

    const field = matchHeaderToCanonicalField(trimmed);
    if (field) {
      if (!(field in suggestedMapping)) suggestedMapping[field] = index;
    } else {
      unmappedColumns.push({ index, header: trimmed });
    }
  });

  const missingFields = CANONICAL_FIELDS.map((f) => f.key).filter((key) => !(key in suggestedMapping));
  const duplicateHeaders = [...seenAt.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([header, indexes]) => ({ header, indexes }));

  return { headers, suggestedMapping, missingFields, unmappedColumns, duplicateHeaders };
}

// .xls (legacy binary BIFF format) is deliberately excluded — exceljs can
// only read OOXML .xlsx, not the old binary format, so a .xls upload is
// rejected up front with a clear message rather than failing confusingly
// mid-parse.
export const SUPPORTED_FILE_EXTENSIONS = [".xlsx", ".csv"] as const;

export function isSupportedFileName(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
