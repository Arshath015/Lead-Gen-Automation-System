import { randomUUID } from "node:crypto";
import { getDb } from "./sqlite";
import type { LeadActivityEvent, LeadActivityType } from "../types/activity";

// SQLite-backed (see ./sqlite.ts for the schema). The JSON-backed
// implementation this replaced is preserved verbatim at
// ./legacy/jsonLeadActivityRepository.ts as a rollback reference — see that
// file's header comment.

export interface LeadActivityInput {
  leadId: string;
  type: LeadActivityType;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

interface LeadActivityRow {
  id: string;
  lead_id: string;
  type: string;
  summary: string;
  metadata: string | null;
  created_at: string;
}

function rowToEvent(row: LeadActivityRow): LeadActivityEvent {
  return {
    id: row.id,
    leadId: row.lead_id,
    type: row.type as LeadActivityType,
    summary: row.summary,
    metadata: row.metadata != null ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
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

  // Writes any number of events in a single SQLite transaction, instead of
  // one read-modify-write per event — see the equivalent comment that used
  // to live on the JSON-backed version (legacy/jsonLeadActivityRepository.ts)
  // for the full history of why this matters: bulk lead creation
  // (leadsRepository.bulkCreate, used by the import pipeline) calls this
  // once per inserted batch, and a large import (the production workbook
  // this was built for has ~654K rows) must never turn into one full-file
  // rewrite per row. With SQLite this is a single transaction of N indexed
  // inserts rather than N full-collection read+rewrites — the same
  // correctness guarantee (every event still gets its own real id/createdAt,
  // nothing is summarized/merged/dropped, a failure rejects rather than
  // silently losing events) with none of the O(N^2) I/O.
  async recordMany(events: LeadActivityInput[]): Promise<LeadActivityEvent[]> {
    if (events.length === 0) return [];
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO lead_activity (id, lead_id, type, summary, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const now = new Date().toISOString();
    const created: LeadActivityEvent[] = events.map((e) => ({
      id: randomUUID(),
      leadId: e.leadId,
      type: e.type,
      summary: e.summary,
      metadata: e.metadata ?? null,
      createdAt: now,
    }));

    db.exec("BEGIN");
    try {
      for (const event of created) {
        insert.run(event.id, event.leadId, event.type, event.summary, event.metadata != null ? JSON.stringify(event.metadata) : null, event.createdAt);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return created;
  },

  async listByLeadId(leadId: string): Promise<LeadActivityEvent[]> {
    const db = getDb();
    // rowid as a tiebreaker preserves insertion order for same-timestamp
    // events (e.g. an entire recordMany() batch sharing one `now`), matching
    // the JSON-backed version's behavior (a stable array sort ties on
    // original array/insertion order too).
    const rows = db
      .prepare("SELECT * FROM lead_activity WHERE lead_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(leadId) as unknown as LeadActivityRow[];
    return rows.map(rowToEvent);
  },

  async deleteAllForLead(leadId: string): Promise<void> {
    const db = getDb();
    db.prepare("DELETE FROM lead_activity WHERE lead_id = ?").run(leadId);
  },
};
