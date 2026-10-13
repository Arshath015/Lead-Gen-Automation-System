import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import type { FollowUpMessage } from "../types/automation";

const COLLECTION = "followUpMessages";

// Messages written before smtpMessageId existed won't have it in the stored
// JSON. Default it on read rather than requiring a migration.
function normalize(message: FollowUpMessage): FollowUpMessage {
  return {
    ...message,
    smtpMessageId: message.smtpMessageId ?? null,
  };
}

// Append-only log of sent follow-up emails, kept separate from the single
// "current draft" per lead in emailDraftsRepository so follow-up history
// doesn't overwrite or get confused with the original AI draft.
export const followUpMessagesRepository = {
  async listAll(): Promise<FollowUpMessage[]> {
    return (await readCollection<FollowUpMessage>(COLLECTION)).map(normalize);
  },

  async create(message: Omit<FollowUpMessage, "id">): Promise<FollowUpMessage> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpMessage>(COLLECTION);
      const created: FollowUpMessage = { ...message, id: randomUUID() };
      await writeCollection(COLLECTION, [...all, created]);
      return created;
    });
  },

  async listByLeadId(leadId: string): Promise<FollowUpMessage[]> {
    const all = await readCollection<FollowUpMessage>(COLLECTION);
    return all.filter((m) => m.leadId === leadId).map(normalize).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  },

  async countSentToday(asOf: Date): Promise<number> {
    const all = await readCollection<FollowUpMessage>(COLLECTION);
    const todayKey = asOf.toDateString();
    return all.filter((m) => new Date(m.sentAt).toDateString() === todayKey).length;
  },

  // Backfills fields (currently just smtpMessageId) onto a follow-up message
  // identified by Resend's own send-id — used by the webhook pipeline once
  // the real SMTP Message-ID becomes known, asynchronously, after the
  // synchronous send already returned and persisted the message record.
  async updateByResendMessageId(resendMessageId: string, patch: Partial<FollowUpMessage>): Promise<FollowUpMessage | null> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<FollowUpMessage>(COLLECTION);
      const idx = all.findIndex((m) => m.resendMessageId === resendMessageId);
      if (idx === -1) return null;
      const updated: FollowUpMessage = { ...normalize(all[idx]), ...patch, id: all[idx].id };
      all[idx] = updated;
      await writeCollection(COLLECTION, all);
      return updated;
    });
  },
};
