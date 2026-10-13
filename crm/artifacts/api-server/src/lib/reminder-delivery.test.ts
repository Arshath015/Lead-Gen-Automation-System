import { describe, expect, it, vi } from "vitest";
import {
  attemptReminderDelivery, canAttemptReminder, nextReminderGeneration, nextReminderRetry, reminderEligible, reminderKey, shouldRetryReminder,
} from "./reminder-delivery";

const scheduled = new Date("2026-09-29T12:00:00Z");
const now = new Date("2026-09-29T11:50:00Z");
type Delivery = { emailStatus: string; attempts: number; nextRetryAt: Date | null };

function pending(): Delivery {
  return { emailStatus: "pending", attempts: 0, nextRetryAt: null };
}

async function run(delivery: Delivery, send: () => Promise<void>, at = now) {
  return attemptReminderDelivery(
    delivery, at, send,
    async attempts => { Object.assign(delivery, { emailStatus: "sent", attempts, nextRetryAt: null }); },
    async (attempts, retryAt) => { Object.assign(delivery, { emailStatus: "retry", attempts, nextRetryAt: retryAt }); },
  );
}

describe("follow-up reminder claims and retry decisions", () => {
  it("increments only on an actual reschedule, including A → B → A", () => {
    const later = new Date(scheduled.getTime() + 60000);
    expect(nextReminderGeneration(scheduled, scheduled, 0)).toBe(0);
    const first = nextReminderGeneration(scheduled, later, 0);
    expect(nextReminderGeneration(later, scheduled, first)).toBe(2);
  });
  it("rechecks the expected schedule and status just before the send", () => {
    expect(reminderEligible({ status: "pending", scheduledAt: scheduled }, scheduled, now)).toBe(true);
    expect(reminderEligible({ status: "pending", scheduledAt: new Date(scheduled.getTime() + 60000) }, scheduled, now)).toBe(false);
    expect(reminderEligible({ status: "pending", scheduledAt: scheduled }, scheduled, new Date(scheduled.getTime() + 6 * 60000))).toBe(false);
  });
  it("permits a due-window failure to retry later without permitting a new late reminder", () => {
    const late = new Date(scheduled.getTime() + 7 * 60000);
    const row = { status: "pending", scheduledAt: scheduled, reminderGeneration: 2 };
    expect(reminderEligible(row, scheduled, late, 2, false)).toBe(false);
    expect(reminderEligible(row, scheduled, late, 2, true)).toBe(true);
    expect(reminderEligible(row, scheduled, late, 1, true)).toBe(false);
    expect(reminderEligible(row, scheduled, new Date(scheduled.getTime() + 18 * 60000), 2, true)).toBe(true);
    expect(reminderEligible(row, scheduled, new Date(scheduled.getTime() + 61 * 60000), 2, true)).toBe(false);
  });
  it.each(["completed", "cancelled"])("never sends a %s follow-up", status => {
    expect(reminderEligible({ status, scheduledAt: scheduled }, scheduled, now)).toBe(false);
  });
  it("records success and never sends again on the next cron scan", async () => {
    const row = pending(); const send = vi.fn().mockResolvedValue(undefined);
    expect(await run(row, send)).toBe(true);
    expect(await run(row, send)).toBe(false);
    expect(row).toMatchObject({ emailStatus: "sent", attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps a Resend error retryable without marking it sent", async () => {
    const row = pending(); const send = vi.fn().mockRejectedValue(new Error("Resend unavailable"));
    expect(await run(row, send)).toBe(false);
    expect(row.emailStatus).toBe("retry");
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).toBeInstanceOf(Date);
  });
  it("retries after a failed delivery, not before backoff elapses", async () => {
    const row = pending();
    const send = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(undefined);
    await run(row, send);
    const retryAt = row.nextRetryAt!;
    expect(await run(row, send, new Date(retryAt.getTime() - 1))).toBe(false);
    expect(await run(row, send, retryAt)).toBe(true);
    expect(row.attempts).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("bounds retries to three attempts", async () => {
    const row: Delivery = { emailStatus: "retry", attempts: 3, nextRetryAt: new Date(0) };
    const send = vi.fn();
    expect(await run(row, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(nextReminderRetry(now, 1).getTime()).toBe(now.getTime() + 120000);
    expect(shouldRetryReminder(2, new Date(scheduled.getTime() + 18 * 60000), scheduled)).toBe(true);
    expect(shouldRetryReminder(2, new Date(scheduled.getTime() + 61 * 60000), scheduled)).toBe(false);
    expect(shouldRetryReminder(3, now, scheduled)).toBe(false);
  });
  it("uses a stable idempotency key across API instances and retries", () => {
    const key = reminderKey(101, 0, scheduled, 7);
    expect(reminderKey(101, 0, scheduled, 7)).toBe(key);
    expect(reminderKey(101, 0, new Date(scheduled.getTime() + 60000), 7)).not.toBe(key);
    expect(reminderKey(101, 0, scheduled, 8)).not.toBe(key);
    // Rescheduling A → B → A is a new generation, not a duplicate.
    expect(reminderKey(101, 2, scheduled, 7)).not.toBe(key);
  });
  it("serializes concurrent scans when the row is locked", async () => {
    const row = pending(); const send = vi.fn().mockResolvedValue(undefined);
    // Models the PostgreSQL SELECT FOR UPDATE around the production call.
    let queue = Promise.resolve();
    const lockedRun = () => {
      const result = queue.then(() => run(row, send));
      queue = result.then(() => undefined);
      return result;
    };
    expect(await Promise.all([lockedRun(), lockedRun()])).toEqual([true, false]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not retry a notification-only or explicitly skipped delivery", () => {
    expect(canAttemptReminder({ emailStatus: "skipped", attempts: 0, nextRetryAt: null }, now)).toBe(false);
  });
});