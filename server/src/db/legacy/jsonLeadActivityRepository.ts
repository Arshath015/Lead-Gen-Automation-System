// ROLLBACK REFERENCE ONLY — not imported by any active code path (except by
// legacy/jsonLeadsRepository.ts, itself only a rollback reference). See that
// file's header comment for the rollback procedure.
import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "../jsonStore";
import type { LeadActivityEvent, LeadActivityType } from "../../types/activity";

const COLLECTION = "leadActivity";

export interface LeadActivityInput {
  leadId: string;
  type: LeadActivityType;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

export const leadActivityRepository = {
  async record(
    leadId: string,
    type: LeadActivityType,
    summary: string,
    metadata: Record<string, unknown> | null = null
  ): Promise<LeadActivityEvent> {
    const [event] = await this.recordMany([{ leadId, type, summary, metadata }]);
    return event;
  },

  // Writes any number of events with a single read-modify-write cycle,
  // instead of one per event — this exists specifically because bulk lead
  // creation (leadsRepository.bulkCreate, used by the import pipeline) used
  // to call record() once per inserted lead. For a large import (the
  // production workbook this was built for has ~654K rows) that meant one
  // full read+rewrite of leadActivity.json PER LEAD against a file that
  // only ever grows — an O(N^2) I/O pattern that would have made a
  // large import take a prohibitive amount of time (and disk I/O) well
  // before it ever finished. A single combined write per batch is also
  // strictly MORE atomic than the old per-event loop, not less: previously
  // an error partway through could leave some leads in a batch with an
  // activity record and others without; here, either every event in the
  // call succeeds together or (see below) none of them are silently lost.
  //
  // Every event still gets its own real id/createdAt and is stored exactly
  // as record() would have stored it individually — this batches the I/O,
  // it does not summarize, merge, or drop any event. A write failure
  // propagates (rejects) rather than being swallowed, so a caller can never
  // mistake "the write failed" for "there was nothing to audit."
  async recordMany(events: LeadActivityInput[]): Promise<LeadActivityEvent[]> {
    if (events.length === 0) return [];
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<LeadActivityEvent>(COLLECTION);
      const now = new Date().toISOString();
      const created: LeadActivityEvent[] = events.map((e) => ({
        id: randomUUID(),
        leadId: e.leadId,
        type: e.type,
        summary: e.summary,
        metadata: e.metadata ?? null,
        createdAt: now,
      }));
      await writeCollection(COLLECTION, [...all, ...created]);
      return created;
    });
  },

  async listByLeadId(leadId: string): Promise<LeadActivityEvent[]> {
    const all = await readCollection<LeadActivityEvent>(COLLECTION);
    return all
      .filter((e) => e.leadId === leadId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  async deleteAllForLead(leadId: string): Promise<void> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<LeadActivityEvent>(COLLECTION);
      const next = all.filter((e) => e.leadId !== leadId);
      if (next.length !== all.length) await writeCollection(COLLECTION, next);
    });
  },
};
