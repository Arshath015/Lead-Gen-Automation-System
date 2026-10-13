import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(__dirname, "../../data");

// Generic binary-blob-on-disk store for uploaded files (signature images,
// default attachments), kept separate from jsonStore.ts (which is for the
// JSON collections) so multi-megabyte file content never bloats a
// read-the-whole-array-into-memory JSON collection — only small metadata
// records (id/filename/contentType/sizeBytes) live in the JSON store; the
// actual bytes live here, one file per id.
function dirFor(bucket: string): string {
  return path.join(DATA_DIR, bucket);
}

// `id` is always our own randomUUID (never derived from a request-supplied
// filename or path), so this can't be used for path traversal.
function fileFor(bucket: string, id: string): string {
  return path.join(dirFor(bucket), id);
}

export async function writeBlob(bucket: string, id: string, content: Buffer): Promise<void> {
  const dir = dirFor(bucket);
  await fs.mkdir(dir, { recursive: true });
  const file = fileFor(bucket, id);
  const tmpFile = `${file}.tmp`;
  await fs.writeFile(tmpFile, content);
  await fs.rename(tmpFile, file);
}

export async function readBlob(bucket: string, id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(fileFor(bucket, id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteBlob(bucket: string, id: string): Promise<void> {
  try {
    await fs.unlink(fileFor(bucket, id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
