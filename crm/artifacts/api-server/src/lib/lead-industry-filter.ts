/** Existing string parameter: plain single value or a JSON array for OR matching. */
export function filterLeadsByIndustry<T extends { lead: { industry: string | null } }>(
  rows: T[],
  industry: string | undefined,
): T[] {
  if (!industry) return rows;
  let industries = [industry];
  try {
    const parsed: unknown = JSON.parse(industry);
    if (Array.isArray(parsed) && parsed.every(value => typeof value === "string" && value.length > 0)) {
      industries = parsed;
    }
  } catch {
    // Preserve plain-text single-industry and legacy links unchanged.
  }
  if (!industries.length) return rows;
  const selected = new Set(industries.map(value => value.toLowerCase()));
  return rows.filter(row => row.lead.industry !== null && selected.has(row.lead.industry.toLowerCase()));
}