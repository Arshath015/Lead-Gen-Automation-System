import { createHash } from "node:crypto";

export const MAX_REMINDER_ATTEMPTS = 3;
export const MAX_REMINDER_RETRY_AGE_MS = 60 * 60_000;

export function nextReminderGeneration(current: Date, requested: Date, generation: number): number {
  return current.getTime() === requested.getTime() ? generation : generation + 1;
}

export function reminderKey(followupId: number, generation: number, scheduledAt: Date, userId: number): string {
  return `followup-${createHash("sha256")
    .update(`${followupId}:${generation}:${scheduledAt.toISOString()}:${userId}`)
    .digest("hex")}`;
}

export function reminderEligible(
  followup: { status: string; scheduledAt: Date; reminderGeneration?: number } | undefined,
  expectedTime: Date,
  now: Date,
  expectedGeneration?: number,
  isRetry = false,
): boolean {
  if (!followup || followup.status !== "pending") return false;
  if (followup.scheduledAt.getTime() !== expectedTime.getTime()) return false;
  if (expectedGeneration !== undefined && followup.reminderGeneration !== expectedGeneration) return false;
  return followup.scheduledAt.getTime() >= now.getTime() - (isRetry ? 60 : 5) * 60_000 &&
    followup.scheduledAt.getTime() <= now.getTime() + 15 * 60_000;
}

export function canAttemptReminder(
  delivery: { emailStatus: string; attempts: number; nextRetryAt: Date | null },
  now: Date,
): boolean {
  return (delivery.emailStatus === "pending" || delivery.emailStatus === "retry") &&
    delivery.attempts < MAX_REMINDER_ATTEMPTS &&
    (!delivery.nextRetryAt || delivery.nextRetryAt <= now);
}

export function nextReminderRetry(now: Date, attempts: number): Date {
  return new Date(now.getTime() + Math.min(2 ** attempts, 8) * 60_000);
}

export function shouldRetryReminder(attempts: number, retryAt: Date, scheduledAt: Date): boolean {
  return attempts < MAX_REMINDER_ATTEMPTS &&
    retryAt.getTime() <= scheduledAt.getTime() + MAX_REMINDER_RETRY_AGE_MS;
}
export async function attemptReminderDelivery(
  delivery: { emailStatus: string; attempts: number; nextRetryAt: Date | null },
  now: Date,
  send: () => Promise<void>,
  markSent: (attempts: number) => Promise<void>,
  markFailed: (attempts: number, retryAt: Date, error: unknown) => Promise<void>,
): Promise<boolean> {
  if (!canAttemptReminder(delivery, now)) return false;
  const attempts = delivery.attempts + 1;
  try {
    await send();
    await markSent(attempts);
    return true;
  } catch (err) {
    await markFailed(attempts, nextReminderRetry(new Date(), attempts), err);
    return false;
  }
}