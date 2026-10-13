import { randomUUID } from "node:crypto";
import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import { deleteBlob, readBlob, writeBlob } from "./fileBlobStore";
import type { SignatureImageAsset } from "../types/emailAssets";

const COLLECTION = "signatureAssets";
const BUCKET = "signature-assets";

export const signatureAssetsRepository = {
  async create(filename: string, contentType: string, content: Buffer): Promise<SignatureImageAsset> {
    const asset: SignatureImageAsset = {
      id: randomUUID(),
      filename,
      contentType,
      sizeBytes: content.length,
      createdAt: new Date().toISOString(),
    };
    // Blob written before the metadata record, so a crash between the two
    // can never leave a metadata entry pointing at a missing file — the
    // reverse (an orphaned blob with no metadata) is harmless and just
    // unreachable disk space.
    await writeBlob(BUCKET, asset.id, content);
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<SignatureImageAsset>(COLLECTION);
      await writeCollection(COLLECTION, [...all, asset]);
      return asset;
    });
  },

  async get(id: string): Promise<SignatureImageAsset | null> {
    const all = await readCollection<SignatureImageAsset>(COLLECTION);
    return all.find((a) => a.id === id) ?? null;
  },

  // Used at send time to embed the image as a CID attachment, and by the
  // raw-serving route for the editor/preview <img> tag.
  async readWithContent(id: string): Promise<(SignatureImageAsset & { content: Buffer }) | null> {
    const asset = await this.get(id);
    if (!asset) return null;
    const content = await readBlob(BUCKET, id);
    if (!content) return null; // Metadata exists but the blob is missing — treat as not found.
    return { ...asset, content };
  },

  async delete(id: string): Promise<boolean> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<SignatureImageAsset>(COLLECTION);
      const next = all.filter((a) => a.id !== id);
      if (next.length === all.length) return false;
      await writeCollection(COLLECTION, next);
      await deleteBlob(BUCKET, id);
      return true;
    });
  },
};
