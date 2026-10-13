// Shared by emailPipeline.ts and followUpPipeline.ts — kept in its own file
// so neither has to import the other for these constants, which would
// otherwise create a circular dependency (emailPipeline schedules the first
// follow-up; followUpPipeline sends it and schedules the next one).

// Bounded automated retries for transient send failures (network blips,
// provider hiccups). Manual sends from the UI are never subject to this cap —
// a human clicking "send" can always retry regardless of attempt count.
export const MAX_AUTO_SEND_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MINUTES = 15;
const RETRY_MAX_DELAY_MINUTES = 240;

// A draft/task left in "sending" longer than this after a crash is treated as
// abandoned (no process is still waiting on it) and safe to resume.
export const STUCK_SENDING_THRESHOLD_MS = 5 * 60_000;

export function computeRetryBackoffMs(attempts: number): number {
  const minutes = Math.min(RETRY_BASE_DELAY_MINUTES * 2 ** Math.max(0, attempts - 1), RETRY_MAX_DELAY_MINUTES);
  return minutes * 60_000;
}
