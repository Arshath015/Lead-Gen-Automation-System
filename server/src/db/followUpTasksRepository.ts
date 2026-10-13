import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import type { FollowUpTask, FollowUpTaskStatus } from "../types/automation";

const COLLECTION = "followUpTasks";

// Tasks written before the retry/idempotency fields existed won't have them
// in the stored JSON. Default them on read rather than requiring a migration.
function normalize(task: FollowUpTask): FollowUpTask {
  return {
    ...task,
    attempts: task.attempts ?? 0,
    lastAttemptAt: task.lastAttemptAt ?? null,
    idempotencyKey: task.idempotencyKey ?? null,
    subject: task.subject ?? null,
    body: task.body ?? null,
    model: task.model ?? null,
  };
}

export const followUpTasksRepository = {
  async create(leadId: string, sequenceNumber: number, scheduledFor: string): Promise<FollowUpTask> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpTask>(COLLECTION);
      const now = new Date().toISOString();
      const task: FollowUpTask = {
        id: randomUUID(),
        leadId,
        sequenceNumber,
        scheduledFor,
        status: "pending",
        error: null,
        attempts: 0,
        lastAttemptAt: null,
        idempotencyKey: null,
        subject: null,
        body: null,
        model: null,
        createdAt: now,
        updatedAt: now,
      };
      await writeCollection(COLLECTION, [...all, task]);
      return task;
    });
  },

  async listByLeadId(leadId: string): Promise<FollowUpTask[]> {
    const all = await readCollection<FollowUpTask>(COLLECTION);
    return all.filter((t) => t.leadId === leadId).map(normalize);
  },

  // Due pending tasks, oldest first — restart-safe since "due" is computed
  // fresh from the persisted scheduledFor timestamp on every call rather than
  // relying on any in-memory timer state. A task that failed a retryable
  // attempt is put back to "pending" with scheduledFor pushed out by the
  // backoff delay, so it naturally reappears here later.
  async listPendingDue(asOf: Date): Promise<FollowUpTask[]> {
    const all = await readCollection<FollowUpTask>(COLLECTION);
    return all
      .filter((t) => t.status === "pending" && new Date(t.scheduledFor).getTime() <= asOf.getTime())
      .map(normalize)
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
  },

  // Tasks left in "sending" from a crash (the process died between the
  // Resend call and recording its result). Anything still "sending" after
  // the stuck threshold has no process left waiting on it and is safe to
  // resume with the same idempotency key.
  async listStuckSending(asOf: Date, thresholdMs: number): Promise<FollowUpTask[]> {
    const all = await readCollection<FollowUpTask>(COLLECTION);
    return all
      .filter(
        (t) =>
          t.status === "sending" &&
          !!t.lastAttemptAt &&
          asOf.getTime() - new Date(t.lastAttemptAt).getTime() >= thresholdMs
      )
      .map(normalize);
  },

  // Persists the generated email content once, before any send attempt, so
  // every retry (including a resumed crashed attempt) replays the exact same
  // payload rather than regenerating different wording each time.
  async setContent(id: string, subject: string, body: string, model: string | null): Promise<void> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpTask>(COLLECTION);
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) return;
      all[idx] = { ...normalize(all[idx]), subject, body, model, updatedAt: new Date().toISOString() };
      await writeCollection(COLLECTION, all);
    });
  },

  // Durable marker written *before* the Resend call so a crash mid-send
  // leaves evidence of the in-flight attempt (and its idempotency key)
  // instead of silently reverting to "pending", which could cause a resumed
  // attempt to send a duplicate email if the original actually went through.
  async markSending(id: string, idempotencyKey: string, attempts: number): Promise<void> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpTask>(COLLECTION);
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) return;
      all[idx] = {
        ...normalize(all[idx]),
        status: "sending",
        attempts,
        lastAttemptAt: new Date().toISOString(),
        idempotencyKey,
        updatedAt: new Date().toISOString(),
      };
      await writeCollection(COLLECTION, all);
    });
  },

  async markSent(id: string): Promise<void> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpTask>(COLLECTION);
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) return;
      all[idx] = { ...normalize(all[idx]), status: "sent", error: null, updatedAt: new Date().toISOString() };
      await writeCollection(COLLECTION, all);
    });
  },

  // retryAt present -> bounded retry still available: goes back to "pending"
  // with scheduledFor pushed out to retryAt. retryAt null -> retries
  // exhausted (or non-retryable failure): terminal "failed".
  async markFailed(id: string, error: string, retryAt: string | null): Promise<void> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpTask>(COLLECTION);
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const current = normalize(all[idx]);
      all[idx] = {
        ...current,
        status: retryAt ? "pending" : "failed",
        scheduledFor: retryAt ?? current.scheduledFor,
        error,
        // Cleared so the next attempt mints a fresh key under its own
        // (incremented) attempt number rather than reusing this failed one.
        idempotencyKey: null,
        updatedAt: new Date().toISOString(),
      };
      await writeCollection(COLLECTION, all);
    });
  },

  async setStatus(id: string, status: FollowUpTaskStatus, error: string | null = null): Promise<void> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpTask>(COLLECTION);
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) return;
      all[idx] = { ...normalize(all[idx]), status, error, updatedAt: new Date().toISOString() };
      await writeCollection(COLLECTION, all);
    });
  },

  // Called whenever a lead stops being a safe automation target (replied,
  // bounced, unsubscribed, marked not interested, or deleted) so no
  // already-scheduled follow-up for it can fire later. Deliberately leaves
  // "sending" tasks alone — one may be genuinely in-flight in this same
  // process, and forcing it to "cancelled" while its real network call is
  // still outstanding would just get overwritten when that call resolves.
  // A stuck "sending" task is instead caught by the eligibility re-check
  // when the scheduler considers resuming it.
  async cancelAllForLead(leadId: string): Promise<number> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpTask>(COLLECTION);
      const now = new Date().toISOString();
      let count = 0;
      for (const task of all) {
        if (task.leadId === leadId && task.status === "pending") {
          task.status = "cancelled";
          task.updatedAt = now;
          count += 1;
        }
      }
      if (count > 0) await writeCollection(COLLECTION, all);
      return count;
    });
  },
};
