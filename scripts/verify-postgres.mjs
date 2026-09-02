#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import {
  APPEND_DOC,
  CREATE_TABLE,
  INSERT_DOC,
  SELECT_DOC,
  TABLE,
  UPDATE_DOC_IF_VERSION,
  UPSERT_DOC,
} from '../lib/storage/postgres-sql.ts';

/**
 * Verifies the Postgres storage layer against a real Postgres engine.
 *
 * PGlite is Postgres itself compiled to WebAssembly, so this exercises genuine
 * jsonb handling, `ON CONFLICT ... DO NOTHING RETURNING`, bigint versions and
 * `rowCount` semantics — not a mock's approximation of them. The statements are
 * imported from `lib/storage/postgres-sql.ts`, the same module the driver uses,
 * so this test cannot drift away from the shipped SQL.
 *
 * Run with:  npm run verify:postgres
 */

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         got      ${JSON.stringify(actual)}`);
    console.log(`         expected ${JSON.stringify(expected)}`);
  }
}

/**
 * PGlite exposes `query`, but not `pg`'s exact result shape for every case, so
 * this thin adapter normalises what the driver relies on: `rows` and `rowCount`.
 */
function adapt(db) {
  return {
    async query(sql, params = []) {
      const result = await db.query(sql, params);
      return {
        rows: result.rows ?? [],
        // PGlite reports affectedRows; pg reports rowCount. The driver reads rowCount.
        rowCount: result.affectedRows ?? result.rows?.length ?? 0,
      };
    },
  };
}

/** Mirrors the driver's readRow, using the same statements. */
async function readRow(client, key, fallback) {
  const existing = await client.query(SELECT_DOC, [key]);
  if (existing.rows.length > 0) return existing.rows[0];

  const inserted = await client.query(INSERT_DOC, [key, JSON.stringify(fallback)]);
  if (inserted.rows.length > 0) return inserted.rows[0];

  const raced = await client.query(SELECT_DOC, [key]);
  return raced.rows[0] ?? { value: fallback, version: '0' };
}

/** Mirrors the driver's backoff so the test models real timing. */
const backoffMs = (attempt) => Math.random() * Math.min(400, 10 * 2 ** (attempt - 1));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mirrors the driver's mutate, using the same statements and retry policy. */
async function mutate(client, key, fallback, mutator, select, onRetry) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const { value, version } = await readRow(client, key, fallback);
    const result = await mutator(value);
    const next = select(value, result);

    const updated = await client.query(UPDATE_DOC_IF_VERSION, [
      JSON.stringify(next),
      key,
      version,
    ]);

    if (updated.rowCount === 1) return result;
    onRetry?.(attempt);
    await sleep(backoffMs(attempt));
  }
  throw new Error(`conflict on ${key}`);
}

/** Mirrors the driver's append: one statement, no retry, no version check. */
async function append(client, key, draft) {
  await readRow(client, key, []);
  const result = await client.query(APPEND_DOC, [JSON.stringify(draft), key]);
  const created = result.rows[0]?.created;
  if (!created) throw new Error(`append failed on ${key}`);
  return created;
}

async function main() {
  console.log('\nVerifying Postgres storage layer against PGlite (real Postgres, WASM)\n');

  const db = new PGlite();
  await db.waitReady;
  const client = adapt(db);

  console.log('--- schema ---');
  await client.query(CREATE_TABLE);
  // Idempotent: the driver runs this on every cold start.
  await client.query(CREATE_TABLE);
  const cols = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position`,
    [TABLE],
  );
  check(
    'table has key/value/version/updated_at',
    cols.rows.map((r) => r.column_name),
    ['key', 'value', 'version', 'updated_at'],
  );
  check('value column is jsonb', cols.rows[1].data_type, 'jsonb');
  check('CREATE TABLE IF NOT EXISTS is idempotent', true, true);

  console.log('\n--- read seeds a missing document ---');
  const seeded = await readRow(client, 'users.json', []);
  check('missing doc seeded with fallback', seeded.value, []);
  check('seeded version is 1', String(seeded.version), '1');

  console.log('\n--- insert semantics (Collection.insert -> atomic append) ---');
  const insert = (record) => append(client, 'users.json', record);

  const first = await insert({ name: 'System Admin', role: 'admin' });
  const second = await insert({ name: 'Viewer', role: 'viewer' });
  check('first insert gets id 1', first.id, 1);
  check('second insert gets id 2', second.id, 2);

  const afterInserts = await readRow(client, 'users.json', []);
  check('both records persisted', afterInserts.value.length, 2);
  check('version incremented twice', String(afterInserts.version), '3');
  check('jsonb round-trips objects', afterInserts.value[0].name, 'System Admin');

  console.log('\n--- update semantics (Collection.update) ---');
  await mutate(
    client,
    'users.json',
    [],
    (items) => {
      const current = items.find((i) => i.id === 2);
      return { ...current, name: 'Renamed Viewer', id: current.id };
    },
    (items, updated) => items.map((i) => (i.id === 2 ? updated : i)),
  );
  const afterUpdate = await readRow(client, 'users.json', []);
  check('record updated in place', afterUpdate.value.find((i) => i.id === 2).name, 'Renamed Viewer');
  check('other record untouched', afterUpdate.value.find((i) => i.id === 1).name, 'System Admin');

  console.log('\n--- compare-and-set rejects a stale version ---');
  const stale = await client.query(UPDATE_DOC_IF_VERSION, [
    JSON.stringify([{ id: 99, name: 'should not land' }]),
    'users.json',
    '1', // deliberately old
  ]);
  check('stale write affects 0 rows', stale.rowCount, 0);
  const unchanged = await readRow(client, 'users.json', []);
  check('document unchanged by stale write', unchanged.value.length, 2);

  const fresh = await client.query(UPDATE_DOC_IF_VERSION, [
    JSON.stringify(unchanged.value),
    'users.json',
    String(unchanged.version),
  ]);
  check('current-version write affects 1 row', fresh.rowCount, 1);

  console.log('\n--- 250 concurrent appends (the audit-log burst) ---');
  await client.query(UPSERT_DOC, ['audit.json', JSON.stringify([])]);

  const BURST = 250;
  const created = await Promise.all(
    Array.from({ length: BURST }, (_, i) => append(client, 'audit.json', { action: `EVENT_${i}` })),
  );

  const audit = await readRow(client, 'audit.json', []);
  check(`all ${BURST} concurrent appends landed`, audit.value.length, BURST);
  check('stored ids are unique', new Set(audit.value.map((e) => e.id)).size, BURST);
  check('returned ids are unique', new Set(created.map((e) => e.id)).size, BURST);
  check(
    'ids are a dense 1..N sequence',
    audit.value.map((e) => e.id).sort((a, b) => a - b),
    Array.from({ length: BURST }, (_, i) => i + 1),
  );
  check('every payload preserved', new Set(audit.value.map((e) => e.action)).size, BURST);

  console.log('\n--- append computes MAX(id)+1, not length+1 (no id reuse after delete) ---');
  await client.query(UPSERT_DOC, [
    'gaps.json',
    JSON.stringify([{ id: 7, name: 'seven' }, { id: 9, name: 'nine' }]),
  ]);
  const afterGap = await append(client, 'gaps.json', { name: 'next' });
  check('next id is 10, not 3', afterGap.id, 10);

  console.log('\n--- a caller-supplied id cannot override the computed one ---');
  const spoofed = await append(client, 'gaps.json', { id: 1, name: 'spoof' });
  check('computed id wins over supplied id', spoofed.id, 11);

  console.log('\n--- removeWhere semantics (cascade delete) ---');
  await client.query(UPSERT_DOC, [
    'sources.json',
    JSON.stringify([
      { id: 1, organizationId: 1, source: 'AWS' },
      { id: 2, organizationId: 1, source: 'GitHub' },
      { id: 3, organizationId: 2, source: 'Vercel' },
    ]),
  ]);
  const removed = await mutate(
    client,
    'sources.json',
    [],
    (items) => items.filter((i) => i.organizationId === 1).length,
    (items, count) => (count > 0 ? items.filter((i) => i.organizationId !== 1) : items),
  );
  check('removeWhere reports 2 removed', removed, 2);
  const remaining = await readRow(client, 'sources.json', []);
  check('only the other org survives', remaining.value.map((i) => i.source), ['Vercel']);

  console.log('\n--- AES envelope survives jsonb round-trip ---');
  const envelope = { v: 1, iv: 'YWJjZGVmZ2hpams=', tag: 'dGFnZ3k=', data: 'Y2lwaGVy' };
  await client.query(UPSERT_DOC, ['enc.json', JSON.stringify([{ id: 1, password: envelope }])]);
  const back = await readRow(client, 'enc.json', []);
  check('ciphertext envelope byte-identical', back.value[0].password, envelope);

  console.log('\n--- rate-limit buckets (object document, not array) ---');
  await mutate(
    client,
    'rate-limits.json',
    {},
    () => undefined,
    (buckets) => ({ ...buckets, 'login:ip:1.2.3.4': { hits: [1, 2, 3] } }),
  );
  const buckets = await readRow(client, 'rate-limits.json', {});
  check('object document persists', buckets.value['login:ip:1.2.3.4'].hits, [1, 2, 3]);

  await db.close();

  console.log(`\n${'='.repeat(46)}`);
  console.log(`  PASS=${pass}  FAIL=${fail}`);
  console.log(`${'='.repeat(46)}\n`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nVerification crashed:', error);
  process.exit(1);
});
