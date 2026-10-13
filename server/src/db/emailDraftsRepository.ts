import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import type { EmailDraft, NewEmailDraft } from "../types/email";

const COLLECTION = "emailDrafts";

// Drafts written before the retry/idempotency fields existed won't have them
// in the stored JSON. Default them on read rather than requiring a migration.
function normalize(draft: EmailDraft): EmailDraft {
  return {
    ...draft,
    sendAttempts: draft.sendAttempts ?? 0,
    lastAttemptAt: draft.lastAttemptAt ?? null,
    nextRetryAt: draft.nextRetryAt ?? null,
    sendIdempotencyKey: draft.sendIdempotencyKey ?? null,
    smtpMessageId: draft.smtpMessageId ?? null,
  };
}

export interface EmailDraftsRepository {
  listAll(): Promise<EmailDraft[]>;
  getByLeadId(leadId: string): Promise<EmailDraft | null>;
  getByLeadIds(leadIds: string[]): Promise<EmailDraft[]>;
  upsert(leadId: string, data: NewEmailDraft, options?: { force?: boolean }): Promise<EmailDraft>;
  update(leadId: string, data: Partial<EmailDraft>): Promise<EmailDraft | null>;
}

class JsonEmailDraftsRepository implements EmailDraftsRepository {
  async listAll(): Promise<EmailDraft[]> {
    return (await readCollection<EmailDraft>(COLLECTION)).map(normalize);
  }

  async getByLeadId(leadId: string): Promise<EmailDraft | null> {
    const all = await readCollection<EmailDraft>(COLLECTION);
    const found = all.find((d) => d.leadId === leadId);
    return found ? normalize(found) : null;
  }

  async getByLeadIds(leadIds: string[]): Promise<EmailDraft[]> {
    const all = await readCollection<EmailDraft>(COLLECTION);
    const idSet = new Set(leadIds);
    return all.filter((d) => idSet.has(d.leadId)).map(normalize);
  }

  // Creates a draft for the lead, or overwrites the existing one unless the
  // user has already edited it (regeneration should not silently discard edits).
  async upsert(leadId: string, data: NewEmailDraft, options: { force?: boolean } = {}): Promise<EmailDraft> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<EmailDraft>(COLLECTION);
      const idx = all.findIndex((d) => d.leadId === leadId);
      const now = new Date().toISOString();

      if (idx !== -1 && all[idx].editedByUser && !options.force) {
        throw new Error("Email draft has user edits; pass force to regenerate anyway");
      }

      if (idx !== -1) {
        const updated: EmailDraft = { ...normalize(all[idx]), ...data, id: all[idx].id, leadId, updatedAt: now };
        all[idx] = updated;
        await writeCollection(COLLECTION, all);
        return updated;
      }

      const created: EmailDraft = {
        ...data,
        id: randomUUID(),
        leadId,
        updatedAt: now,
        sendStatus: "not_sent",
        sentAt: null,
        resendMessageId: null,
        smtpMessageId: null,
        sendError: null,
        sendAttempts: 0,
        lastAttemptAt: null,
        nextRetryAt: null,
        sendIdempotencyKey: null,
      };
      await writeCollection(COLLECTION, [...all, created]);
      return created;
    });
  }

  async update(leadId: string, data: Partial<EmailDraft>): Promise<EmailDraft | null> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<EmailDraft>(COLLECTION);
      const idx = all.findIndex((d) => d.leadId === leadId);
      if (idx === -1) return null;
      const updated: EmailDraft = {
        ...normalize(all[idx]),
        ...data,
        id: all[idx].id,
        leadId: all[idx].leadId,
        updatedAt: new Date().toISOString(),
      };
      all[idx] = updated;
      await writeCollection(COLLECTION, all);
      return updated;
    });
  }
}

export const emailDraftsRepository: EmailDraftsRepository = new JsonEmailDraftsRepository();
