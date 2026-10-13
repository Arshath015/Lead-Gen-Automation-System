import { randomUUID } from "node:crypto";
import { readCollection, writeCollection } from "./jsonStore";
import type { IcpProfile, NewIcpProfile } from "../types/icp";

const COLLECTION = "icpProfiles";

export interface IcpRepository {
  list(): Promise<IcpProfile[]>;
  getById(id: string): Promise<IcpProfile | null>;
  create(data: NewIcpProfile): Promise<IcpProfile>;
  update(id: string, data: Partial<NewIcpProfile>): Promise<IcpProfile | null>;
  delete(id: string): Promise<boolean>;
}

class JsonIcpRepository implements IcpRepository {
  async list(): Promise<IcpProfile[]> {
    return readCollection<IcpProfile>(COLLECTION);
  }

  async getById(id: string): Promise<IcpProfile | null> {
    const all = await this.list();
    return all.find((p) => p.id === id) ?? null;
  }

  async create(data: NewIcpProfile): Promise<IcpProfile> {
    const all = await this.list();
    const now = new Date().toISOString();
    const profile: IcpProfile = {
      id: randomUUID(),
      name: data.name,
      filters: data.filters,
      createdAt: now,
      updatedAt: now,
    };
    all.push(profile);
    await writeCollection(COLLECTION, all);
    return profile;
  }

  async update(id: string, data: Partial<NewIcpProfile>): Promise<IcpProfile | null> {
    const all = await this.list();
    const idx = all.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const updated: IcpProfile = {
      ...all[idx],
      ...data,
      filters: data.filters ? { ...all[idx].filters, ...data.filters } : all[idx].filters,
      updatedAt: new Date().toISOString(),
    };
    all[idx] = updated;
    await writeCollection(COLLECTION, all);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const all = await this.list();
    const next = all.filter((p) => p.id !== id);
    if (next.length === all.length) return false;
    await writeCollection(COLLECTION, next);
    return true;
  }
}

export const icpRepository: IcpRepository = new JsonIcpRepository();
