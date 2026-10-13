export interface ParsedEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Parse a structured email note content into its parts.
 *
 * Expected format (written by emails.ts on send):
 *   **To:** recipient@example.com
 *   **Subject:** The subject line
 *
 *   Optional body text here
 *
 * Returns null when the content doesn't have the expected header format,
 * so callers can fall back to plain-text rendering for legacy notes.
 */
export function parseEmailNote(content: string): ParsedEmail | null {
  const toMatch = content.match(/^\*\*To:\*\* (.+)$/m);
  const subjectMatch = content.match(/^\*\*Subject:\*\* (.+)$/m);

  if (!toMatch && !subjectMatch) {
    return null;
  }

  const bodyStart = content.indexOf("\n\n");
  const body = bodyStart !== -1 ? content.slice(bodyStart + 2) : "";

  return {
    to: toMatch?.[1]?.trim() ?? "",
    subject: subjectMatch?.[1]?.trim() ?? "",
    body,
  };
}
