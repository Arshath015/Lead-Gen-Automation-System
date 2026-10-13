import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import type { NewResearchBrief, ResearchBrief } from "../types/research";

const COLLECTION = "researchBriefs";

export interface ResearchBriefsRepository {
  getByLeadId(leadId: string): Promise<ResearchBrief | null>;
  getByLeadIds(leadIds: string[]): Promise<ResearchBrief[]>;
  upsert(leadId: string, data: NewResearchBrief, options?: { force?: boolean }): Promise<ResearchBrief>;
  update(leadId: string, data: Partial<ResearchBrief>): Promise<ResearchBrief | null>;
}

class JsonResearchBriefsRepository implements ResearchBriefsRepository {
  async getByLeadId(leadId: string): Promise<ResearchBrief | null> {
    const all = await readCollection<ResearchBrief>(COLLECTION);
    return all.find((b) => b.leadId === leadId) ?? null;
  }

  async getByLeadIds(leadIds: string[]): Promise<ResearchBrief[]> {
    const all = await readCollection<ResearchBrief>(COLLECTION);
    const idSet = new Set(leadIds);
    return all.filter((b) => idSet.has(b.leadId));
  }

  // Creates a brief for the lead, or overwrites the existing one unless the
  // user has already edited it (regeneration should not silently discard edits).
  async upsert(leadId: string, data: NewResearchBrief, options: { force?: boolean } = {}): Promise<ResearchBrief> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<ResearchBrief>(COLLECTION);
      const idx = all.findIndex((b) => b.leadId === leadId);
      const now = new Date().toISOString();

      if (idx !== -1 && all[idx].editedByUser && !options.force) {
        throw new Error("Research brief has user edits; pass force to regenerate anyway");
      }

      if (idx !== -1) {
        const updated: ResearchBrief = { ...all[idx], ...data, id: all[idx].id, leadId, updatedAt: now };
        all[idx] = updated;
        await writeCollection(COLLECTION, all);
        return updated;
      }

      const created: ResearchBrief = { ...data, id: randomUUID(), leadId, createdAt: now, updatedAt: now };
      await writeCollection(COLLECTION, [...all, created]);
      return created;
    });
  }

  async update(leadId: string, data: Partial<ResearchBrief>): Promise<ResearchBrief | null> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<ResearchBrief>(COLLECTION);
      const idx = all.findIndex((b) => b.leadId === leadId);
      if (idx === -1) return null;
      const updated: ResearchBrief = {
        ...all[idx],
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

export const researchBriefsRepository: ResearchBriefsRepository = new JsonResearchBriefsRepository();
