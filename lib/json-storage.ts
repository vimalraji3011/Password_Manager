import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Tiny JSON "database".
 *
 * Design goals:
 *  - **Atomic writes.** Data is written to a temp file in the same directory
 *    and then `rename()`d over the target. rename() is atomic on both NTFS and
 *    POSIX, so a crash mid-write can never leave a half-written vault file.
 *  - **Serialised access.** All reads/writes for a given file go through a
 *    promise chain, so two concurrent API requests can't clobber each other
 *    (the classic read-modify-write race with plain fs calls).
 *  - **Self-healing.** A missing file is created from its default value, and a
 *    corrupt file is moved aside rather than crashing the app.
 *
 * The `Collection` API deliberately mirrors a repository interface so Phase-N+1
 * can swap the implementation for Prisma/Drizzle without touching callers.
 */

const DATA_DIR = path.join(process.cwd(), 'data');

/** file path -> tail of the operation queue for that file */
const locks = new Map<string, Promise<unknown>>();

/** Run `fn` exclusively with respect to other operations on the same file. */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  // Swallow the predecessor's rejection so one failure doesn't poison the queue.
  const run = previous.catch(() => undefined).then(fn);
  locks.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function resolveFile(fileName: string): string {
  // Guard against path traversal in case a file name is ever derived from input.
  const safe = path.basename(fileName);
  return path.join(DATA_DIR, safe);
}

async function readRaw<T>(fileName: string, fallback: T): Promise<T> {
  const file = resolveFile(fileName);
  try {
    const text = await fs.readFile(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      await ensureDataDir();
      await writeRaw(fileName, fallback);
      return fallback;
    }
    if (error instanceof SyntaxError) {
      // Corrupt JSON: quarantine it so the operator can inspect it, then reset.
      const quarantine = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, quarantine).catch(() => undefined);
      console.error(`[json-storage] ${fileName} was corrupt; moved to ${quarantine}`);
      await writeRaw(fileName, fallback);
      return fallback;
    }
    throw error;
  }
}

async function writeRaw<T>(fileName: string, value: T): Promise<void> {
  await ensureDataDir();
  const file = resolveFile(fileName);
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;

  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(payload, 'utf8');
    // fsync before rename: guarantees the bytes are on disk, not just in cache.
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Read a JSON file, no locking. Safe because reads are non-mutating. */
export function readJson<T>(fileName: string, fallback: T): Promise<T> {
  return withLock(fileName, () => readRaw(fileName, fallback));
}

/** Replace a whole JSON file atomically. */
export function writeJson<T>(fileName: string, value: T): Promise<void> {
  return withLock(fileName, () => writeRaw(fileName, value));
}

/**
 * Read-modify-write under a lock. This is the only safe way to mutate a file
 * when more than one request may be in flight.
 */
export function updateJson<T, R>(
  fileName: string,
  fallback: T,
  mutator: (current: T) => R | Promise<R>,
  select: (current: T, result: R) => T = (current) => current,
): Promise<R> {
  return withLock(fileName, async () => {
    const current = await readRaw(fileName, fallback);
    const result = await mutator(current);
    await writeRaw(fileName, select(current, result));
    return result;
  });
}

/** Every stored entity carries a numeric id. */
export interface Entity {
  id: number;
}

/**
 * A typed array-of-records collection backed by one JSON file.
 * All mutating methods are atomic and race-free.
 */
export class Collection<T extends Entity> {
  constructor(private readonly fileName: string) {}

  all(): Promise<T[]> {
    return readJson<T[]>(this.fileName, []);
  }

  async find(predicate: (item: T) => boolean): Promise<T | undefined> {
    return (await this.all()).find(predicate);
  }

  async byId(id: number): Promise<T | undefined> {
    return this.find((item) => item.id === id);
  }

  async filter(predicate: (item: T) => boolean): Promise<T[]> {
    return (await this.all()).filter(predicate);
  }

  /** Append a record, assigning the next free id. */
  insert(draft: Omit<T, 'id'>): Promise<T> {
    return withLock(this.fileName, async () => {
      const items = await readRaw<T[]>(this.fileName, []);
      const nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      const created = { ...draft, id: nextId } as T;
      await writeRaw(this.fileName, [...items, created]);
      return created;
    });
  }

  /** Patch one record. Returns the updated record, or null when not found. */
  update(id: number, patch: Partial<T> | ((item: T) => Partial<T>)): Promise<T | null> {
    return withLock(this.fileName, async () => {
      const items = await readRaw<T[]>(this.fileName, []);
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const current = items[index]!;
      const delta = typeof patch === 'function' ? patch(current) : patch;
      const updated = { ...current, ...delta, id: current.id } as T;
      const next = [...items];
      next[index] = updated;
      await writeRaw(this.fileName, next);
      return updated;
    });
  }

  /** Remove one record. Returns true when something was actually removed. */
  remove(id: number): Promise<boolean> {
    return withLock(this.fileName, async () => {
      const items = await readRaw<T[]>(this.fileName, []);
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) return false;
      await writeRaw(this.fileName, next);
      return true;
    });
  }

  /** Remove every record matching `predicate`. Returns the removed count. */
  removeWhere(predicate: (item: T) => boolean): Promise<number> {
    return withLock(this.fileName, async () => {
      const items = await readRaw<T[]>(this.fileName, []);
      const next = items.filter((item) => !predicate(item));
      const removed = items.length - next.length;
      if (removed > 0) await writeRaw(this.fileName, next);
      return removed;
    });
  }
}

export const FILES = {
  users: 'users.json',
  organizations: 'organizations.json',
  sources: 'sources.json',
  audit: 'audit.json',
  resetRequests: 'reset-requests.json',
} as const;
