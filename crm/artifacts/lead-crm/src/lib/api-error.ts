/**
 * Shared utility for extracting human-readable error messages from API
 * responses and mapping server-side validation errors to form fields.
 *
 * Backend returns:  { "error": "message string" }  with HTTP 4xx.
 * Future field-level shape:  { "errors": { "field": "message" } }
 */

export interface ParsedApiError {
  general: string;
  fields: Record<string, string>;
}

/**
 * Parse an error thrown by a React Query mutation (or any fetch error)
 * into a structured shape ready for inline form display.
 *
 * Usage in a catch block:
 *   } catch (e) {
 *     const { general, fields } = parseApiError(e);
 *     setServerError(general);
 *     if (Object.keys(fields).length) setFormErrors(prev => ({ ...prev, ...fields }));
 *   }
 */
export function parseApiError(e: unknown): ParsedApiError {
  const fallback = "An unexpected error occurred. Please try again.";

  if (!e || typeof e !== "object") {
    return { general: typeof e === "string" ? e : fallback, fields: {} };
  }

  const err = e as Record<string, unknown>;

  // Field-level errors — e.g. { errors: { companyName: "Required" } }
  const fields: Record<string, string> = {};
  if (err.errors && typeof err.errors === "object") {
    for (const [k, v] of Object.entries(err.errors as Record<string, unknown>)) {
      if (typeof v === "string") fields[k] = v;
    }
  }

  // General message — from Error instance or { error: "..." } response body
  let general = fallback;
  if (typeof err.message === "string" && err.message) {
    general = err.message;
  } else if (typeof err.error === "string" && err.error) {
    general = err.error;
  }

  return { general, fields };
}

/**
 * Convenience wrapper — returns only the general error string.
 * Use when you only need a single banner message.
 */
export function extractErrorMessage(e: unknown): string {
  return parseApiError(e).general;
}
