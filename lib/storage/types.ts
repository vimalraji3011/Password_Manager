/**
 * Storage driver contract.
 *
 * The whole persistence layer is expressed as "named JSON documents", because
 * that is exactly what the original JSON-file design was — `users.json` is one
 * document holding an array of users. Keeping that shape means the Postgres
 * driver needs one table and no per-entity schema, and `Collection<T>` sits
 * unchanged on top of either driver.
 *
 * The only operation that genuinely matters is `mutate`: read a document,
 * transform it, write it back, with nothing else able to interleave. Everything
 * else in the app is built from that guarantee.
 */
export interface StorageDriver {
  /** Human-readable driver name, used in diagnostics. */
  readonly name: 'filesystem' | 'postgres';

  /** Read a document, returning `fallback` when it does not exist yet. */
  read<T>(key: string, fallback: T): Promise<T>;

  /** Replace a document wholesale. */
  write<T>(key: string, value: T): Promise<void>;

  /**
   * Atomic read-modify-write.
   *
   * `mutator` receives the current document and returns a result; `select`
   * derives the document to persist from that result. Splitting the two lets a
   * caller return something other than the document itself — `insert` returns
   * the created record while persisting the whole array, for instance.
   *
   * **`mutator` must be pure and retry-safe.** The Postgres driver detects write
   * conflicts and calls it again with fresher data, so side effects inside it
   * could happen more than once.
   */
  mutate<T, R>(
    key: string,
    fallback: T,
    mutator: (current: T) => R | Promise<R>,
    select: (current: T, result: R) => T,
  ): Promise<R>;

  /**
   * Append a record to an array document, assigning the next free id.
   *
   * Split out from `mutate` because append is the app's hottest write (every
   * audited event is one) and it does not actually need read-modify-write. The
   * Postgres driver implements it as a single statement, which makes a lost
   * write impossible no matter how many writers contend. See `APPEND_DOC`.
   */
  append<T extends { id: number }>(key: string, draft: Omit<T, 'id'>): Promise<T>;

  /** Create whatever the driver needs before first use. Idempotent. */
  init?(): Promise<void>;
}

/** Thrown when a driver cannot reconcile concurrent writes. */
export class StorageConflictError extends Error {
  constructor(key: string, attempts: number) {
    super(
      `Could not safely write "${key}" after ${attempts} attempts because another ` +
        'request kept changing it. Please retry.',
    );
    this.name = 'StorageConflictError';
  }
}
