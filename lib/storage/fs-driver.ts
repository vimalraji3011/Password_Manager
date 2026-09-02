import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { StorageDriver } from '@/lib/storage/types';

/**
 * Filesystem driver — JSON documents under `data/`.
 *
 * This is the original storage engine and remains the default for local
 * development and any deployment with a real disk. Its two guarantees:
 *
 *  - **Atomic writes.** Data is written to a temp file in the same directory,
 *    `fsync`ed, then `rename()`d over the target. `rename` is atomic on both
 *    NTFS and POSIX, so a crash mid-write cannot leave a half-written vault.
 *  - **Serialised access.** All operations on a given file queue behind one
 *    another, which removes the read-modify-write race two concurrent requests
 *    would otherwise hit.
 *
 * That second guarantee is *per process*, which is exactly why this driver
 * cannot be used on a horizontally scaled host — see `postgres-driver.ts`.
 */

const DATA_DIR = path.join(process.cwd(), 'data');

/** file key -> tail of the operation queue for that file */
const locks = new Map<string, Promise<unknown>>();

/** Run `fn` exclusively with respect to other operations on the same key. */
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

function resolveFile(key: string): string {
  // Guard against path traversal in case a key is ever derived from input.
  return path.join(DATA_DIR, path.basename(key));
}

/**
 * Documents that are deliberately not backed up.
 *
 * Rate-limit buckets are rewritten constantly, hold nothing worth recovering,
 * and would double this driver's write volume for no benefit.
 */
const NO_BACKUP = new Set(['rate-limits.json']);

/** `organizations.json` -> `organizations.backup.json` */
function backupPath(file: string): string {
  return file.replace(/\.json$/i, '') + '.backup.json';
}

/**
 * Keep the previous contents before overwriting.
 *
 * The temp-file + rename dance below already rules out a *torn* write, but it
 * cannot help with a write that succeeds and is wrong — a bad migration, a
 * cascading delete that took more than intended, an operator editing the file
 * by hand. One generation back is enough to recover from that, and for a vault
 * whose whole datastore is a few hundred kilobytes of JSON the cost is
 * negligible.
 *
 * Never allowed to fail the write it is protecting: if the backup cannot be
 * taken, the real write still goes ahead and the problem is logged.
 */
async function backup(file: string): Promise<void> {
  if (NO_BACKUP.has(path.basename(file))) return;
  try {
    await fs.copyFile(file, backupPath(file));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // First write of a new document: nothing to preserve yet.
    if (err.code === 'ENOENT') return;
    console.error(`[storage:fs] could not back up ${path.basename(file)}`, err.code ?? err);
  }
}

async function writeRaw<T>(key: string, value: T): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = resolveFile(key);
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

  // Snapshot the outgoing version while it is still on disk.
  await backup(file);

  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Parse the backup copy, or null when there isn't a usable one. */
async function restoreFromBackup<T>(file: string): Promise<T | null> {
  try {
    const text = await fs.readFile(backupPath(file), 'utf8');
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    // No backup, or the backup is corrupt too. Caller falls back to the seed.
    return null;
  }
}

async function readRaw<T>(key: string, fallback: T): Promise<T> {
  const file = resolveFile(key);
  try {
    const text = await fs.readFile(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'ENOENT') {
      await writeRaw(key, fallback);
      return fallback;
    }

    if (error instanceof SyntaxError) {
      // Corrupt JSON: quarantine it so an operator can inspect it.
      const quarantine = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, quarantine).catch(() => undefined);
      console.error(`[storage:fs] ${key} was corrupt; moved to ${quarantine}`);

      /**
       * Recover from the backup rather than resetting.
       *
       * Silently handing back an empty collection here would look, to every
       * layer above, exactly like "the vault is empty" — and the next write
       * would then persist that emptiness over the top. Restoring the previous
       * generation turns a total loss into the loss of one write.
       */
      const restored = await restoreFromBackup<T>(file);
      if (restored !== null) {
        console.error(`[storage:fs] restored ${key} from its backup`);
        await writeRaw(key, restored);
        return restored;
      }

      await writeRaw(key, fallback);
      return fallback;
    }

    throw error;
  }
}

export function createFilesystemDriver(): StorageDriver {
  return {
    name: 'filesystem',

    read: (key, fallback) => withLock(key, () => readRaw(key, fallback)),

    write: (key, value) => withLock(key, () => writeRaw(key, value)),

    mutate: (key, fallback, mutator, select) =>
      withLock(key, async () => {
        const current = await readRaw(key, fallback);
        const result = await mutator(current);
        await writeRaw(key, select(current, result));
        return result;
      }),

    append: <T extends { id: number }>(key: string, draft: Omit<T, 'id'>) =>
      withLock(key, async () => {
        const items = await readRaw<T[]>(key, []);
        // max + 1 rather than length + 1: deletions must not cause id reuse.
        const nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
        const created = { ...draft, id: nextId } as T;
        await writeRaw(key, [...items, created]);
        return created;
      }),

    init: async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
    },
  };
}
