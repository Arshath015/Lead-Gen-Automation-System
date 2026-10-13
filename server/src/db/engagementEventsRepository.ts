import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import type { EngagementEvent, EngagementEventType } from "../types/engagement";

const COLLECTION = "engagementEvents";

export const engagementEventsRepository = {
  // Inserts a new engagement event unless one with the same webhookEventId
  // already exists, in which case it returns null and does nothing —
  // Resend/Svix can redeliver the same webhook event on a timeout or retry,
  // and this is the single gate that makes reprocessing it a safe no-op
  // instead of double-recording an open/click/bounce or re-applying a lead
  // status transition a second time.
  async recordIfNew(
    webhookEventId: string,
    data: Omit<EngagementEvent, "id" | "webhookEventId" | "createdAt">
  ): Promise<EngagementEvent | null> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<EngagementEvent>(COLLECTION);
      if (all.some((e) => e.webhookEventId === webhookEventId)) return null;
      const event: EngagementEvent = {
        ...data,
        id: randomUUID(),
        webhookEventId,
        createdAt: new Date().toISOString(),
      };
      await writeCollection(COLLECTION, [...all, event]);
      return event;
    });
  },

  async listByLeadId(leadId: string): Promise<EngagementEvent[]> {
    const all = await readCollection<EngagementEvent>(COLLECTION);
    return all.filter((e) => e.leadId === leadId).sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  },

  async listByLeadIds(leadIds: string[]): Promise<EngagementEvent[]> {
    const idSet = new Set(leadIds);
    const all = await readCollection<EngagementEvent>(COLLECTION);
    return all.filter((e) => e.leadId && idSet.has(e.leadId));
  },

  async listByEmailId(emailId: string): Promise<EngagementEvent[]> {
    const all = await readCollection<EngagementEvent>(COLLECTION);
    return all.filter((e) => e.emailId === emailId);
  },

  async countOccurrencesOfType(emailId: string, type: EngagementEventType): Promise<number> {
    const all = await readCollection<EngagementEvent>(COLLECTION);
    return all.filter((e) => e.emailId === emailId && e.type === type).length;
  },

  async listAll(): Promise<EngagementEvent[]> {
    return readCollection<EngagementEvent>(COLLECTION);
  },

  async deleteAllForLead(leadId: string): Promise<void> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<EngagementEvent>(COLLECTION);
      const next = all.filter((e) => e.leadId !== leadId);
      if (next.length !== all.length) await writeCollection(COLLECTION, next);
    });
  },
};
