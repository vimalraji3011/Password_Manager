#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Bootstraps the datastore with the two accounts the app ships with and a small
 * set of demo organizations and credentials.
 *
 * Writes to whichever backend the app itself would use:
 *   - Postgres, when DATABASE_URL / POSTGRES_URL is set (or --postgres is passed)
 *   - JSON files under ./data otherwise
 *
 * That is what makes seeding a Vercel deployment possible: run this locally with
 * the production DATABASE_URL exported, and it populates the same rows the
 * deployed app reads.
 *
 * Safe to run repeatedly: it refuses to overwrite existing users unless
 * `--force` is passed, so a real vault can never be wiped by a stray seed.
 *
 * Usage:
 *   npm run seed
 *   npm run seed -- --force        recreate everything from scratch
 *   npm run seed -- --no-demo      accounts only, empty vault
 *   npm run seed -- --postgres     force the Postgres target
 */

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const FORCE = process.argv.includes('--force');
const NO_DEMO = process.argv.includes('--no-demo');
const FORCE_PG = process.argv.includes('--postgres');

const TABLE = 'opm_documents';

const KEYS = {
  users: 'users.json',
  organizations: 'organizations.json',
  sources: 'sources.json',
  audit: 'audit.json',
  resetRequests: 'reset-requests.json',
  rateLimits: 'rate-limits.json',
};

/* -------------------------------------------------------------- *
 * Minimal .env loader — the script runs outside the Next.js
 * runtime, so nothing has populated process.env for us.
 * -------------------------------------------------------------- */
async function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    let text;
    try {
      text = await fs.readFile(path.join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue; // first file (and real env) wins
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}

function postgresUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    null
  );
}

function getMasterKey() {
  const raw = process.env.MASTER_ENCRYPTION_KEY?.trim();
  if (!raw) {
    console.error(
      '\nMASTER_ENCRYPTION_KEY is not set.\n' +
        'Run `npm run genkey`, put the values in .env.local, then seed again.\n',
    );
    process.exit(1);
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    console.error('\nMASTER_ENCRYPTION_KEY must decode to 32 bytes. Run `npm run genkey`.\n');
    process.exit(1);
  }
  return key;
}

/** Mirrors `lib/crypto.ts` — same envelope shape, same algorithm. */
function encrypt(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/* -------------------------------------------------------------- *
 * Targets — each exposes the same read/write pair, so the seeding
 * logic below does not care where the data lands.
 * -------------------------------------------------------------- */

function filesystemTarget() {
  return {
    label: `JSON files in ${path.relative(ROOT, DATA_DIR) || 'data'}/`,

    async read(key) {
      try {
        return JSON.parse(await fs.readFile(path.join(DATA_DIR, key), 'utf8'));
      } catch {
        return null;
      }
    },

    async write(key, value) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const target = path.join(DATA_DIR, key);
      const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fs.rename(tmp, target);
    },

    async close() {},
  };
}

async function postgresTarget(url) {
  // Imported lazily so a filesystem-only setup never needs `pg` resolved.
  const { default: pg } = await import('pg');

  const client = new pg.Client({
    connectionString: url,
    ssl: /\bsslmode=disable\b/.test(url) ? false : { rejectUnauthorized: false },
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      key        text PRIMARY KEY,
      value      jsonb NOT NULL,
      version    bigint NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Redact credentials before echoing the destination back to the operator.
  const safeHost = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname}`;
    } catch {
      return 'the configured database';
    }
  })();

  return {
    label: `Postgres at ${safeHost}`,

    async read(key) {
      const result = await client.query(`SELECT value FROM ${TABLE} WHERE key = $1`, [key]);
      return result.rows.length > 0 ? result.rows[0].value : null;
    },

    async write(key, value) {
      await client.query(
        `INSERT INTO ${TABLE} (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               version = ${TABLE}.version + 1,
               updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    },

    async close() {
      await client.end();
    },
  };
}

async function resolveTarget() {
  const url = postgresUrl();
  if (FORCE_PG && !url) {
    console.error('\n--postgres was passed but no DATABASE_URL / POSTGRES_URL is set.\n');
    process.exit(1);
  }
  return url ? postgresTarget(url) : filesystemTarget();
}

/* -------------------------------------------------------------- *
 * Seeding
 * -------------------------------------------------------------- */

async function main() {
  await loadEnv();
  const key = getMasterKey();
  const target = await resolveTarget();

  try {
    const existing = await target.read(KEYS.users);

    if (Array.isArray(existing) && existing.length > 0 && !FORCE) {
      console.log(
        `\n${target.label} already holds ${existing.length} account(s) — nothing was changed.\n` +
          'Pass --force to wipe and recreate the datastore:  npm run seed -- --force\n',
      );
      return;
    }

    const now = new Date().toISOString();

    const accounts = [
      {
        role: 'admin',
        name: process.env.SEED_ADMIN_NAME || 'System Admin',
        email: (process.env.SEED_ADMIN_EMAIL || 'admin@company.com').toLowerCase(),
        mobile: process.env.SEED_ADMIN_MOBILE || '9876543210',
        password: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
      },
      {
        role: 'viewer',
        name: process.env.SEED_VIEWER_NAME || 'Viewer',
        email: (process.env.SEED_VIEWER_EMAIL || 'viewer@company.com').toLowerCase(),
        mobile: process.env.SEED_VIEWER_MOBILE || '9876543211',
        password: process.env.SEED_VIEWER_PASSWORD || 'Viewer@12345',
      },
    ];

    const users = [];
    for (const [index, account] of accounts.entries()) {
      users.push({
        id: index + 1,
        name: account.name,
        email: account.email,
        mobile: account.mobile,
        passwordHash: await bcrypt.hash(account.password, 12),
        role: account.role,
        lastLogin: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const demo = NO_DEMO
      ? { organizations: [], sources: [] }
      : buildDemoVault(users[0].name, now, key);

    await target.write(KEYS.users, users);
    await target.write(KEYS.organizations, demo.organizations);
    await target.write(KEYS.sources, demo.sources);
    await target.write(KEYS.audit, []);
    await target.write(KEYS.resetRequests, []);
    await target.write(KEYS.rateLimits, {});

    console.log(`
Datastore ready — ${target.label}

  Admin   ${accounts[0].email}   ${accounts[0].password}
  Viewer  ${accounts[1].email}   ${accounts[1].password}

  Organizations: ${demo.organizations.length}
  Credentials:   ${demo.sources.length}

Change both passwords after the first sign-in.
`);
  } finally {
    await target.close();
  }
}

function buildDemoVault(actor, now, key) {
  const organizations = [
    { id: 1, name: 'Aafiya', description: 'Primary operating company' },
    { id: 2, name: 'Netkathir', description: 'Engineering and infrastructure' },
    { id: 3, name: 'Corporate IT', description: 'Shared internal services' },
  ].map((org) => ({ ...org, createdAt: now, updatedAt: now, updatedBy: actor }));

  const raw = [
    [1, 'AWS', 'admin@company.com', 'https://aws.amazon.com', 'Root account. MFA enforced.'],
    [1, 'GitHub', 'devops@company.com', 'https://github.com', 'Organization owner.'],
    [1, 'Azure', 'admin@company.com', 'https://portal.azure.com', ''],
    [1, 'Gmail', 'info@company.com', 'https://mail.google.com', 'Shared inbox.'],
    [2, 'Cloudflare', 'infra@company.com', 'https://dash.cloudflare.com', 'DNS and WAF.'],
    [2, 'Vercel', 'devops@company.com', 'https://vercel.com', ''],
    [3, 'Zoho Mail', 'it@company.com', 'https://mail.zoho.com', 'Mail admin console.'],
  ];

  const sources = raw.map(([organizationId, source, username, url, notes], index) => ({
    id: index + 1,
    organizationId,
    source,
    username,
    // Demo values only — replace them as soon as the vault is in real use.
    password: encrypt(`Demo-${source.replace(/\s+/g, '')}-${1000 + index}!`, key),
    url,
    notes,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
  }));

  return { organizations, sources };
}

main().catch((error) => {
  console.error('\nSeeding failed:', error);
  process.exit(1);
});
