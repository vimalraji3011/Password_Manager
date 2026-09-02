import { Pool, type PoolConfig } from 'pg';
import {
  APPEND_DOC,
  CREATE_TABLE,
  INSERT_DOC,
  SELECT_DOC,
  UPDATE_DOC_IF_VERSION,
  UPSERT_DOC,
} from '@/lib/storage/postgres-sql';
import { StorageConflictError, type StorageDriver } from '@/lib/storage/types';

/**
 * Postgres driver — the same JSON documents, stored as `jsonb` rows.
 *
 * Why this exists: on a serverless host (Vercel, and anything else that scales
 * horizontally) the filesystem driver breaks in two ways. The disk is read-only
 * and ephemeral, and its in-process lock cannot coordinate between instances.
 * Both problems disappear if the document lives in Postgres.
 *
 * **Concurrency: optimistic, not locking.** Each row carries a `version`. A
 * write is `UPDATE ... WHERE key = $1 AND version = $2`; if it matches no rows,
 * someone else got there first, so we re-read and retry. Compare with the
 * obvious alternative, `SELECT ... FOR UPDATE` inside a transaction: that needs
 * an interactive transaction held open across a round trip, which is precisely
 * what serverless connections handle worst. Optimistic writes keep every
 * statement independent, so they survive cold starts, connection churn and
 * HTTP-based Postgres proxies.
 *
 * Contention here is negligible in practice — this is a small internal vault —
 * so the retry loop effectively never spins. The statements themselves live in
 * `postgres-sql.ts` and are verified against a real engine by
 * `scripts/verify-postgres.mjs`.
 */

const MAX_ATTEMPTS = 10;

/**
 * Exponential backoff with full jitter, capped at 400 ms.
 *
 * Full jitter (a uniform pick from `[0, ceiling]`, not `ceiling ± noise`) is the
 * important part: fixed or lightly-jittered delays leave racing writers retrying
 * in lockstep, so they keep colliding. Spreading them across the whole interval
 * is what actually breaks up the convoy.
 */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(400, 10 * 2 ** (attempt - 1));
  return Math.random() * ceiling;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reused across warm invocations; a new pool per request would exhaust the server. */
let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function connectionString(): string {
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!url) {
    throw new Error(
      'STORAGE_DRIVER is "postgres" but no connection string was found. ' +
        'Set DATABASE_URL (or POSTGRES_URL) in your environment.',
    );
  }
  return url;
}

function getPool(): Pool {
  if (pool) return pool;

  const url = connectionString();

  const config: PoolConfig = {
    connectionString: url,
    /**
     * One connection per instance. A serverless platform may run many instances,
     * so a large pool per instance multiplies into the provider's connection
     * limit. Use a *pooled* connection string (Neon's `-pooler` host, Supabase's
     * pgBouncer port) in production.
     */
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Managed Postgres uses TLS with certificates this client cannot chain to a
    // local root store; the connection is still encrypted.
    ssl: /\bsslmode=disable\b/.test(url) ? false : { rejectUnauthorized: false },
  };

  pool = new Pool(config);

  // A dropped idle connection must not become an unhandled error event.
  pool.on('error', (error) => {
    console.error('[storage:postgres] idle client error', error);
  });

  return pool;
}

/** Create the table on first use, once per process. */
function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = getPool()
    .query(CREATE_TABLE)
    .then(() => undefined)
    .catch((error: unknown) => {
      // Allow a later request to retry rather than caching the failure forever.
      schemaReady = null;
      throw error;
    });

  return schemaReady;
}

interface Row<T> {
  value: T;
  version: string;
}

/** Read the document with its version, seeding the row if it is absent. */
async function readRow<T>(key: string, fallback: T): Promise<Row<T>> {
  await ensureSchema();
  const client = getPool();

  const existing = await client.query<Row<T>>(SELECT_DOC, [key]);
  if (existing.rows.length > 0) return existing.rows[0]!;

  // Seed it. ON CONFLICT covers the race where two requests seed at once; the
  // RETURNING clause then comes back empty, so re-read to get the winner's row.
  const inserted = await client.query<Row<T>>(INSERT_DOC, [key, JSON.stringify(fallback)]);
  if (inserted.rows.length > 0) return inserted.rows[0]!;

  const raced = await client.query<Row<T>>(SELECT_DOC, [key]);
  return raced.rows[0] ?? { value: fallback, version: '0' };
}

export function createPostgresDriver(): StorageDriver {
  return {
    name: 'postgres',

    async read<T>(key: string, fallback: T): Promise<T> {
      return (await readRow(key, fallback)).value;
    },

    async write<T>(key: string, value: T): Promise<void> {
      await ensureSchema();
      await getPool().query(UPSERT_DOC, [key, JSON.stringify(value)]);
    },

    async mutate<T, R>(
      key: string,
      fallback: T,
      mutator: (current: T) => R | Promise<R>,
      select: (current: T, result: R) => T,
    ): Promise<R> {
      await ensureSchema();
      const client = getPool();

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { value, version } = await readRow(key, fallback);

        const result = await mutator(value);
        const next = select(value, result);

        const updated = await client.query(UPDATE_DOC_IF_VERSION, [
          JSON.stringify(next),
          key,
          version,
        ]);

        // rowCount === 1 means our version was still current: the write is ours.
        if (updated.rowCount === 1) return result;

        // Lost the race: re-read and recompute after a backoff.
        await sleep(backoffMs(attempt));
      }

      throw new StorageConflictError(key, MAX_ATTEMPTS);
    },

    /**
     * Single statement, no retry loop, no version check — Postgres computes the
     * id and concatenates the element under the UPDATE's own row lock, so
     * concurrent appends serialise in the database instead of fighting in the
     * application. This is what makes a burst of audit writes safe.
     */
    async append<T extends { id: number }>(key: string, draft: Omit<T, 'id'>): Promise<T> {
      await ensureSchema();
      const client = getPool();

      // The row must exist for UPDATE to match; readRow seeds it if it does not.
      await readRow<T[]>(key, []);

      const result = await client.query<{ created: T }>(APPEND_DOC, [
        JSON.stringify(draft),
        key,
      ]);

      const created = result.rows[0]?.created;
      if (!created) {
        // The row vanished between seeding and the append — only possible if
        // something outside the app deleted it.
        throw new Error(`Failed to append to "${key}": the document is missing.`);
      }
      return created;
    },

    init: ensureSchema,
  };
}
