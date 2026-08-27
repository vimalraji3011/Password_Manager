#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Bootstraps `data/` with the two accounts the app ships with and a small set
 * of demo organizations and credentials.
 *
 * Safe to run repeatedly: it refuses to overwrite an existing users.json unless
 * `--force` is passed, so a real vault can never be wiped by a stray `npm run
 * seed`.
 *
 * Usage:
 *   npm run seed
 *   npm run seed -- --force        (recreate everything from scratch)
 *   npm run seed -- --no-demo      (accounts only, empty vault)
 */

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const FORCE = process.argv.includes('--force');
const NO_DEMO = process.argv.includes('--no-demo');

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
      if (process.env[key] !== undefined) continue; // first file wins
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
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

async function writeFileAtomic(name, value) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, name);
  const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, target);
}

async function exists(name) {
  try {
    await fs.access(path.join(DATA_DIR, name));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await loadEnv();
  const key = getMasterKey();

  if ((await exists('users.json')) && !FORCE) {
    console.log(
      '\ndata/users.json already exists — nothing was changed.\n' +
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

  await writeFileAtomic('users.json', users);

  const demo = NO_DEMO
    ? { organizations: [], sources: [] }
    : buildDemoVault(users[0].name, now, key);

  await writeFileAtomic('organizations.json', demo.organizations);
  await writeFileAtomic('sources.json', demo.sources);
  await writeFileAtomic('audit.json', []);
  await writeFileAtomic('reset-requests.json', []);

  console.log(`
Datastore created in ./data

  Admin   ${accounts[0].email}   ${accounts[0].password}
  Viewer  ${accounts[1].email}   ${accounts[1].password}

  Organizations: ${demo.organizations.length}
  Credentials:   ${demo.sources.length}

Change both passwords after the first sign-in.
`);
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
