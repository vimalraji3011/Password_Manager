/**
 * Every SQL statement the Postgres driver issues.
 *
 * Extracted into its own dependency-free module for one reason: it lets
 * `scripts/verify-postgres.mjs` run these exact strings against a real Postgres
 * engine (PGlite) without importing the driver and therefore without pulling in
 * `pg`, `server-only` and the path aliases. The test verifies the real SQL, not
 * a copy of it that can silently drift.
 *
 * Keep this file free of imports so Node can execute it directly with
 * `--experimental-strip-types`.
 */

export const TABLE = 'opm_documents';

/**
 * One table, one row per document. `version` is the optimistic-concurrency
 * token: a writer only wins if the version it read is still current.
 */
export const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    version    bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

export const SELECT_DOC = `SELECT value, version FROM ${TABLE} WHERE key = $1`;

/**
 * Seed a missing document. `DO NOTHING` makes two racing seeders safe; the loser
 * gets an empty RETURNING and re-reads.
 */
export const INSERT_DOC = `
  INSERT INTO ${TABLE} (key, value) VALUES ($1, $2)
  ON CONFLICT (key) DO NOTHING
  RETURNING value, version
`;

/** Unconditional overwrite, used by `write()` where no compare-and-set applies. */
export const UPSERT_DOC = `
  INSERT INTO ${TABLE} (key, value) VALUES ($1, $2)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        version = ${TABLE}.version + 1,
        updated_at = now()
`;

/**
 * The compare-and-set at the heart of `mutate()`. `rowCount === 1` means our
 * version was still current and the write is ours; `0` means someone else
 * committed first and the caller must re-read and retry.
 */
export const UPDATE_DOC_IF_VERSION = `
  UPDATE ${TABLE}
     SET value = $1, version = version + 1, updated_at = now()
   WHERE key = $2 AND version = $3
`;

/**
 * Atomic append with server-computed id — the fix for the audit log.
 *
 * Appending via read-modify-write means N concurrent writers each have a 1/N
 * chance of winning a round, so a burst of audit entries can exhaust any retry
 * budget. This does the whole job in one statement instead: Postgres concatenates
 * onto the `jsonb` array and derives `id` as `MAX(id) + 1` over the existing
 * elements, all under the row lock the UPDATE already takes. No version check,
 * no retry, and a lost write is impossible however many writers pile on.
 *
 * `$1 || jsonb_build_object('id', …)` puts the computed id *last* so it always
 * wins over any id the caller happened to pass.
 *
 * RETURNING sees the post-update row, so the last element is the new record.
 */
export const APPEND_DOC = `
  UPDATE ${TABLE}
     SET value = value || jsonb_build_array(
           $1::jsonb || jsonb_build_object(
             'id',
             COALESCE(
               (SELECT MAX((element ->> 'id')::bigint)
                  FROM jsonb_array_elements(value) AS element),
               0
             ) + 1
           )
         ),
         version = version + 1,
         updated_at = now()
   WHERE key = $2
  RETURNING value -> (jsonb_array_length(value) - 1) AS created
`;
