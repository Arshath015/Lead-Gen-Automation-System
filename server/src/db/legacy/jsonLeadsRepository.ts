// ROLLBACK REFERENCE ONLY — not imported by any active code path.
//
// This is the flat-JSON-file-backed LeadsRepository implementation that ran
// in production before the SQLite migration (see ../sqlite.ts,
// ../leadsRepository.ts, ../migrateJsonToSqlite.ts). Kept verbatim here,
// alongside the untouched original server/data/leads.json /
// leadActivity.json files, as the rollback path: if the SQLite-backed
// repository ever needs to be reverted, point ../leadsRepository.ts's export
// back at `JsonLeadsRepository` from this file (and the equivalent in
// jsonLeadActivityRepository.ts) — the JSON data files were never modified
// by the migration, so this class works against them exactly as it always
// did.
import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "../jsonStore";
import { leadActivityRepository } from "./jsonLeadActivityRepository";
import type { Lead, NewLead, LeadStatus } from "../../types/lead";

const COLLECTION = "leads";

// Leads written before engagementStatus/automationEnabled existed won't have
// them in the stored JSON. Default them on read rather than requiring a
// migration — "active"/enabled is the correct implicit value for old rows.
function normalize(lead: Lead): Lead {
  return {
    ...lead,
    engagementStatus: lead.engagementStatus ?? "active",
    automationEnabled: lead.automationEnabled ?? true,
    phone: lead.phone ?? null,
    roleCategory: lead.roleCategory ?? null,
    industry: lead.industry ?? null,
    sourceFile: lead.sourceFile ?? null,
    sourceWorksheet: lead.sourceWorksheet ?? null,
  };
}

export interface LeadFilter {
  status?: LeadStatus;
  icpProfileId?: string;
  search?: string; // matches name/company/email
}

export interface BulkCreateResult {
  inserted: Lead[];
  skippedDuplicates: number;
}

export interface LeadsRepository {
  list(filter?: LeadFilter): Promise<Lead[]>;
  getById(id: string): Promise<Lead | null>;
  getByIds(ids: string[]): Promise<Lead[]>;
  bulkCreate(newLeads: NewLead[]): Promise<BulkCreateResult>;
  update(id: string, data: Partial<Lead>): Promise<Lead | null>;
  bulkUpdateStatus(ids: string[], status: LeadStatus): Promise<number>;
  delete(id: string): Promise<boolean>;
}

class JsonLeadsRepository implements LeadsRepository {
  async list(filter: LeadFilter = {}): Promise<Lead[]> {
    let all = (await readCollection<Lead>(COLLECTION)).map(normalize);
    if (filter.status) {
      all = all.filter((l) => l.status === filter.status);
    }
    if (filter.icpProfileId) {
      all = all.filter((l) => l.icpProfileId === filter.icpProfileId);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      all = all.filter(
        (l) =>
          l.fullName.toLowerCase().includes(q) ||
          (l.company ?? "").toLowerCase().includes(q) ||
          (l.email ?? "").toLowerCase().includes(q)
      );
    }
    return all;
  }

  async getById(id: string): Promise<Lead | null> {
    const all = await readCollection<Lead>(COLLECTION);
    const found = all.find((l) => l.id === id);
    return found ? normalize(found) : null;
  }

  async getByIds(ids: string[]): Promise<Lead[]> {
    const all = await readCollection<Lead>(COLLECTION);
    const idSet = new Set(ids);
    return all.filter((l) => idSet.has(l.id)).map(normalize);
  }

  // Every mutation below is serialized through the same collection lock used
  // by the other repositories (emailDrafts, followUpTasks, automationSettings).
  // Leads are now written from more than just the UI — the Resend webhook
  // handler updates engagementStatus from an unpredictable inbound request —
  // so an unlocked read-modify-write could silently lose one writer's change
  // if two mutations land at the same time.
  async bulkCreate(newLeads: NewLead[]): Promise<BulkCreateResult> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<Lead>(COLLECTION);
      const existingKeys = new Set(all.map((l) => l.dedupKey));
      const now = new Date().toISOString();
      const inserted: Lead[] = [];
      let skippedDuplicates = 0;

      for (const nl of newLeads) {
        if (existingKeys.has(nl.dedupKey)) {
          skippedDuplicates += 1;
          continue;
        }
        const lead: Lead = {
          id: randomUUID(),
          status: nl.status ?? "new",
          source: nl.source,
          sourceId: nl.sourceId,
          dedupKey: nl.dedupKey,
          email: nl.email,
          fullName: nl.fullName,
          title: nl.title,
          company: nl.company,
          companyDomain: nl.companyDomain,
          linkedinUrl: nl.linkedinUrl,
          phone: nl.phone,
          location: nl.location,
          icpProfileId: nl.icpProfileId,
          searchRunId: nl.searchRunId,
          raw: nl.raw,
          engagementStatus: nl.engagementStatus ?? "active",
          automationEnabled: nl.automationEnabled ?? true,
          roleCategory: nl.roleCategory ?? null,
          industry: nl.industry ?? null,
          sourceFile: nl.sourceFile ?? null,
          sourceWorksheet: nl.sourceWorksheet ?? null,
          crmLeadId: null,
          crmPushedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        existingKeys.add(lead.dedupKey);
        inserted.push(lead);
      }

      if (inserted.length > 0) {
        await writeCollection(COLLECTION, [...all, ...inserted]);
        // One batched write for the whole insert, not one read-modify-write
        // per lead — see leadActivityRepository.recordMany's own comment for
        // why (a large import would otherwise churn leadActivity.json once
        // per row, an O(N^2) I/O pattern that never finishes at real scale).
        await leadActivityRepository.recordMany(
          inserted.map((lead) => ({
            leadId: lead.id,
            type: "lead_created" as const,
            summary: lead.source === "manual" ? "Lead added manually" : `Lead found via ${lead.source}`,
          }))
        );
      }

      return { inserted, skippedDuplicates };
    });
  }

  async update(id: string, data: Partial<Lead>): Promise<Lead | null> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<Lead>(COLLECTION);
      const idx = all.findIndex((l) => l.id === id);
      if (idx === -1) return null;
      const updated: Lead = {
        ...normalize(all[idx]),
        ...data,
        id: all[idx].id,
        updatedAt: new Date().toISOString(),
      };
      all[idx] = updated;
      await writeCollection(COLLECTION, all);
      return updated;
    });
  }

  async bulkUpdateStatus(ids: string[], status: LeadStatus): Promise<number> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<Lead>(COLLECTION);
      const idSet = new Set(ids);
      let count = 0;
      const now = new Date().toISOString();
      for (const lead of all) {
        if (idSet.has(lead.id)) {
          lead.status = status;
          lead.updatedAt = now;
          count += 1;
        }
      }
      if (count > 0) await writeCollection(COLLECTION, all);
      return count;
    });
  }

  async delete(id: string): Promise<boolean> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<Lead>(COLLECTION);
      const next = all.filter((l) => l.id !== id);
      if (next.length === all.length) return false;
      await writeCollection(COLLECTION, next);
      return true;
    });
  }
}

export const leadsRepository: LeadsRepository = new JsonLeadsRepository();
