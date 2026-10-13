import type { CanonicalField } from "../../types";

// Display-only manifest for the column-mapping UI — labels/tiers mirror
// server/src/import/schema.ts's CANONICAL_FIELDS, but never the alias
// matching logic itself (the backend already returns each worksheet's
// suggestedMapping; the frontend just lets the user override it).
export interface CanonicalFieldMeta {
  key: CanonicalField;
  label: string;
  tier: "core" | "optional";
}

export const CANONICAL_FIELD_META: CanonicalFieldMeta[] = [
  { key: "contactName", label: "Contact Name", tier: "core" },
  { key: "company", label: "Company", tier: "core" },
  { key: "email", label: "Email", tier: "core" },
  { key: "designation", label: "Designation", tier: "optional" },
  { key: "roleCategory", label: "Role Category", tier: "optional" },
  { key: "phone", label: "Mobile / Phone", tier: "optional" },
  { key: "city", label: "City", tier: "optional" },
  { key: "state", label: "State", tier: "optional" },
  { key: "industry", label: "Industry", tier: "optional" },
  { key: "sourceFile", label: "Source File", tier: "optional" },
];

export const CANONICAL_FIELD_KEYS: CanonicalField[] = CANONICAL_FIELD_META.map((f) => f.key);

export function canonicalFieldLabel(key: CanonicalField): string {
  return CANONICAL_FIELD_META.find((f) => f.key === key)?.label ?? key;
}

// Fields a worksheet needs at least one of to plausibly be a per-row contact
// table at all, derived from CANONICAL_FIELD_META's own "core" tier rather
// than hardcoded again here.
const CORE_CONTACT_FIELDS: CanonicalField[] = CANONICAL_FIELD_META.filter((f) => f.tier === "core").map((f) => f.key);

// A worksheet missing EVERY core identifying field (company, contact name,
// email) almost certainly isn't a contact table at all — e.g. a "Master
// Summary"/rollup tab (Sheet Name, Role(s), Records, With Email, With
// Mobile/Phone, Unique Companies, With Industry Tag, Source File). That real
// example is why this can't require ALL ten canonical fields to be missing
// (the earlier version of this check): its "Source File" column happens to
// alias-match the optional `sourceFile` field, so only 9 of 10 are ever
// missing — a coincidental non-core match that says nothing about whether
// the sheet actually contains contacts. Requiring all three CORE fields
// absent is both necessary and sufficient here: any sheet with even one of
// company/contactName/email detected has at least a plausible per-row
// identity column and is left as a normal mapping card; a sheet with none of
// the three — no matter how many optional/incidental fields happen to
// match — is not.
export function isLikelyNonContactSheet(missingFields: CanonicalField[]): boolean {
  const missing = new Set(missingFields);
  return CORE_CONTACT_FIELDS.every((f) => missing.has(f));
}
