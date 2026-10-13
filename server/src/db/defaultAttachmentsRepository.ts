import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import { deleteBlob, readBlob, writeBlob } from "./fileBlobStore";
import type { DefaultAttachment } from "../types/emailAssets";

const COLLECTION = "defaultAttachments";
const BUCKET = "attachments";

export const defaultAttachmentsRepository = {
  async listAll(): Promise<DefaultAttachment[]> {
    return readCollection<DefaultAttachment>(COLLECTION);
  },

  // The set actually merged into a real send by composeEmailBody — recomputed
  // fresh on every send/retry from this live list, never snapshotted onto a
  // draft, so toggling an attachment off takes effect immediately and a
  // retried send can never duplicate an attachment.
  async listIncluded(): Promise<DefaultAttachment[]> {
    const all = await readCollection<DefaultAttachment>(COLLECTION);
    return all.filter((a) => a.includeByDefault);
  },

  async create(filename: string, contentType: string, content: Buffer): Promise<DefaultAttachment> {
    const attachment: DefaultAttachment = {
      id: randomUUID(),
      filename,
      contentType,
      sizeBytes: content.length,
      // New uploads are included by default — that's the point of the
      // feature; the user can flip it off per-file afterward.
      includeByDefault: true,
      createdAt: new Date().toISOString(),
    };
    await writeBlob(BUCKET, attachment.id, content);
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<DefaultAttachment>(COLLECTION);
      await writeCollection(COLLECTION, [...all, attachment]);
      return attachment;
    });
  },

  async update(id: string, data: Partial<Pick<DefaultAttachment, "includeByDefault">>): Promise<DefaultAttachment | null> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<DefaultAttachment>(COLLECTION);
      const idx = all.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      const updated = { ...all[idx], ...data };
      all[idx] = updated;
      await writeCollection(COLLECTION, all);
      return updated;
    });
  },

  async readContent(id: string): Promise<Buffer | null> {
    return readBlob(BUCKET, id);
  },

  async delete(id: string): Promise<boolean> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<DefaultAttachment>(COLLECTION);
      const next = all.filter((a) => a.id !== id);
      if (next.length === all.length) return false;
      await writeCollection(COLLECTION, next);
      await deleteBlob(BUCKET, id);
      return true;
    });
  },
};
