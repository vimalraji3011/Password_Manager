import 'server-only';
import { createFilesystemDriver } from '@/lib/storage/fs-driver';
import { createPostgresDriver } from '@/lib/storage/postgres-driver';
import type { StorageDriver } from '@/lib/storage/types';

/**
 * Driver selection.
 *
 * `STORAGE_DRIVER` decides explicitly; with nothing set the app auto-detects,
 * which is what makes "clone and `npm run dev`" work with no configuration while
 * a Vercel deployment picks Postgres on its own.
 *
 * Detection order:
 *  1. explicit `STORAGE_DRIVER=filesystem|postgres`
 *  2. a Postgres connection string is present  → postgres
 *  3. running on a read-only serverless host   → postgres (and fail loudly if
 *     no connection string exists, because the filesystem driver cannot work)
 *  4. otherwise                                → filesystem
 */

let driver: StorageDriver | null = null;

function hasPostgresUrl(): boolean {
  return Boolean(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL ??
      process.env.POSTGRES_URL_NON_POOLING,
  );
}

/**
 * True on hosts whose filesystem is read-only and ephemeral. `VERCEL` is set in
 * every Vercel runtime; `AWS_LAMBDA_FUNCTION_NAME` covers Lambda directly and
 * the platforms built on it.
 */
function isServerless(): boolean {
  return Boolean(process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function getStorageDriver(): StorageDriver {
  if (driver) return driver;

  const configured = process.env.STORAGE_DRIVER?.trim().toLowerCase();

  if (configured === 'postgres') {
    driver = createPostgresDriver();
  } else if (configured === 'filesystem') {
    if (isServerless()) {
      // Refuse rather than fail obscurely on the first write, which would look
      // like a broken login instead of a misconfiguration.
      throw new Error(
        'STORAGE_DRIVER=filesystem cannot work on a serverless host: the disk is ' +
          'read-only and ephemeral. Set STORAGE_DRIVER=postgres and provide DATABASE_URL.',
      );
    }
    driver = createFilesystemDriver();
  } else if (hasPostgresUrl()) {
    driver = createPostgresDriver();
  } else if (isServerless()) {
    throw new Error(
      'This deployment has no persistent filesystem, so the vault needs a database. ' +
        'Provision Postgres and set DATABASE_URL (Vercel Postgres, Neon and Supabase all work). ' +
        'See the "Deploying to Vercel" section of the README.',
    );
  } else {
    driver = createFilesystemDriver();
  }

  return driver;
}

/** Which driver is active. Surfaced on the dashboard for operator confidence. */
export function storageDriverName(): StorageDriver['name'] {
  return getStorageDriver().name;
}

export type { StorageDriver };
export { StorageConflictError } from '@/lib/storage/types';
