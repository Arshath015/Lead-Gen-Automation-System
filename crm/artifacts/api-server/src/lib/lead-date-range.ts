const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET = "+05:30";
const ONE_MILLISECOND = 1;

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Converts either a date input value or a full ISO timestamp into the inclusive
 * lower boundary used by every lead-classification query.
 */
export function parseLeadRangeStart(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (DATE_ONLY_PATTERN.test(value)) {
    return validDate(`${value}T00:00:00.000${IST_OFFSET}`);
  }
  return validDate(value);
}

/**
 * Converts either a date input value or the dashboard's inclusive ISO end into
 * an exclusive upper boundary. Date-only values become midnight at the start
 * of the following IST calendar day.
 */
export function parseLeadRangeEndExclusive(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;

  if (DATE_ONLY_PATTERN.test(value)) {
    const startOfSelectedDay = validDate(`${value}T00:00:00.000${IST_OFFSET}`);
    return startOfSelectedDay
      ? new Date(startOfSelectedDay.getTime() + 24 * 60 * 60 * 1000)
      : undefined;
  }

  const inclusiveEnd = validDate(value);
  return inclusiveEnd
    ? new Date(inclusiveEnd.getTime() + ONE_MILLISECOND)
    : undefined;
}