/** Keep the existing string query field and historical single-value links. */
export function decodeIndustrySelection(value: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(item => typeof item === "string" && item.length > 0)) {
      return [...new Set(parsed as string[])];
    }
  } catch {
    // A legacy single industry is plain text, not JSON.
  }
  return [value];
}

export function encodeIndustrySelection(values: string[]): string {
  const unique = [...new Set(values)];
  if (!unique.length) return "";
  // Escape JSON-looking historical values rather than changing their contents.
  if (unique.length === 1 && !unique[0].startsWith("[")) return unique[0];
  return JSON.stringify(unique);
}

export function toggleIndustrySelection(values: string[], industry: string): string[] {
  return values.includes(industry)
    ? values.filter(value => value !== industry)
    : [...values, industry];
}