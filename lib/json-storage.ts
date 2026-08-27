import 'server-only';
import { getStorageDriver } from '@/lib/storage';

/**
 * The datastore.
 *
 * This file is the API the rest of the app uses; the *mechanism* lives in
 * `lib/storage/`, behind a driver interface. Two drivers ship:
 *
 *  - **filesystem** — JSON files under `data/`, atomic via temp-file + rename.
 *    The default locally and on any host with a real disk.
 *  - **postgres** — the same documents as `jsonb` rows, safe for serverless and
 *    horizontally scaled hosts (Vercel). Selected automatically when a Postgres
 *    connection string is present.
 *
 * Nothing above this layer knows or cares which is active, which is the whole
 * point: the storage swap needed for Vercel touched no route handler, no page
 * and no component.
 *
 * The `Collection` API deliberately mirrors a repository interface, so a future
 * move to per-entity SQL tables stays local to `lib/storage/`.
 */

/** Read a document, seeding it with `fallback` when absent. */
export function readJson<T>(fileName: string, fallback: T): Promise<T> {
  return getStorageDriver().read(fileName, fallback);
}

/** Replace a whole document atomically. */
export function writeJson<T>(fileName: string, value: T): Promise<void> {
  return getStorageDriver().write(fileName, value);
}

/**
 * Atomic read-modify-write — the only safe way to mutate a document when more
 * than one request may be in flight.
 *
 * **`mutator` must be pure and retry-safe.** The Postgres driver detects write
 * conflicts and re-runs it against fresher data, so a side effect inside it
 * (sending an email, say) could fire more than once. Do that work in the caller,
 * after this resolves.
 */
export function updateJson<T, R>(
  fileName: string,
  fallback: T,
  mutator: (current: T) => R | Promise<R>,
  select: (current: T, result: R) => T = (current) => current,
): Promise<R> {
  return getStorageDriver().mutate(fileName, fallback, mutator, select);
}

/** Every stored entity carries a numeric id. */
export interface Entity {
  id: number;
}

/**
 * A typed array-of-records collection backed by one document.
 * All mutating methods are atomic and race-free under either driver.
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

  /**
   * Append a record, assigning the next free id.
   *
   * Delegated to the driver's dedicated append rather than built from
   * read-modify-write: under Postgres it becomes a single atomic statement, so
   * concurrent inserts serialise in the database and can neither collide on an
   * id nor lose a write. That matters most for the audit log, which takes a
   * write on every audited event.
   */
  insert(draft: Omit<T, 'id'>): Promise<T> {
    return getStorageDriver().append<T>(this.fileName, draft);
  }

  /** Patch one record. Returns the updated record, or null when not found. */
  update(id: number, patch: Partial<T> | ((item: T) => Partial<T>)): Promise<T | null> {
    return updateJson<T[], T | null>(
      this.fileName,
      [],
      (items) => {
        const current = items.find((item) => item.id === id);
        if (!current) return null;
        const delta = typeof patch === 'function' ? patch(current) : patch;
        // `id` last: a patch must never be able to renumber a record.
        return { ...current, ...delta, id: current.id } as T;
      },
      (items, updated) =>
        updated ? items.map((item) => (item.id === id ? updated : item)) : items,
    );
  }

  /** Remove one record. Returns true when something was actually removed. */
  remove(id: number): Promise<boolean> {
    return updateJson<T[], boolean>(
      this.fileName,
      [],
      (items) => items.some((item) => item.id === id),
      (items, existed) => (existed ? items.filter((item) => item.id !== id) : items),
    );
  }

  /** Remove every record matching `predicate`. Returns the removed count. */
  removeWhere(predicate: (item: T) => boolean): Promise<number> {
    return updateJson<T[], number>(
      this.fileName,
      [],
      (items) => items.filter(predicate).length,
      (items, removed) => (removed > 0 ? items.filter((item) => !predicate(item)) : items),
    );
  }
}

export const FILES = {
  users: 'users.json',
  organizations: 'organizations.json',
  sources: 'sources.json',
  audit: 'audit.json',
  resetRequests: 'reset-requests.json',
  rateLimits: 'rate-limits.json',
} as const;
