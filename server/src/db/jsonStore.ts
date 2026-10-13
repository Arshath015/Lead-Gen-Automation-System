import fs from "node:fs/promises";
import path from "node:path";

// Overridable so tests can redirect storage to a throwaway temp directory
// instead of ever touching real production data under server/data — unset in
// every normal run (dev/build/start), so default behavior is unchanged.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, "../../data");

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function fileFor(collection: string): string {
  return path.join(DATA_DIR, `${collection}.json`);
}

export async function readCollection<T>(collection: string): Promise<T[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(fileFor(collection), "utf-8");
    return JSON.parse(raw) as T[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function writeCollection<T>(collection: string, items: T[]): Promise<void> {
  await ensureDataDir();
  const file = fileFor(collection);
  const tmpFile = `${file}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(items, null, 2), "utf-8");
  await fs.rename(tmpFile, file);
}

const collectionLocks = new Map<string, Promise<unknown>>();

// Serializes read-modify-write cycles for a given collection so concurrent
// callers (e.g. bulk generation loops, overlapping requests) can't clobber
// each other's writes.
export function withCollectionLock<T>(collection: string, fn: () => Promise<T>): Promise<T> {
  const previous = collectionLocks.get(collection) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  collectionLocks.set(
    collection,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}
