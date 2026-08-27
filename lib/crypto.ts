import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import type { EncryptedValue } from '@/types';

/**
 * Vault encryption.
 *
 * Login passwords are hashed with bcrypt (see `lib/auth.ts`) — one way, on
 * purpose. Stored *credentials* are a different problem: an authorised user has
 * to be able to read them back, so they are **encrypted**, never hashed.
 *
 * AES-256-GCM is used because it is authenticated: tampering with the stored
 * ciphertext (e.g. editing data/sources.json by hand) makes decryption fail
 * loudly rather than returning garbage.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const KEY_LENGTH = 32; // AES-256

let cachedKey: Buffer | null = null;

/**
 * Resolve MASTER_ENCRYPTION_KEY into 32 raw bytes.
 * Accepts 64 hex chars or base64; anything else is rejected at first use so a
 * misconfiguration surfaces immediately instead of silently weakening crypto.
 */
export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.MASTER_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'MASTER_ENCRYPTION_KEY is not set. Run `npm run genkey` and add it to .env.local.',
    );
  }

  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). ` +
        'Use `npm run genkey` to generate a valid key.',
    );
  }

  cachedKey = key;
  return key;
}

/** True when the server is configured well enough to encrypt/decrypt. */
export function isEncryptionConfigured(): boolean {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plaintext: string): EncryptedValue {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(value: EncryptedValue): string {
  if (!value || value.v !== 1) {
    throw new Error('Unsupported ciphertext envelope version.');
  }
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(value.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key or tampered payload — both are security-relevant, so don't leak which.
    throw new Error(
      'Unable to decrypt credential. The MASTER_ENCRYPTION_KEY may have changed, ' +
        'or the stored data was modified.',
    );
  }
}

/** Best-effort decrypt for list views that must not 500 on one bad record. */
export function tryDecrypt(value: EncryptedValue): string | null {
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

/** 6-digit numeric OTP, generated with a CSPRNG. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** URL-safe one-time token for approval / reset links. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** OTPs and tokens are stored hashed so a leaked data file can't be replayed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for hashed tokens. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generator used by the "suggest a strong password" button. */
export function generatePassword(length = 20): string {
  const sets = [
    'abcdefghijkmnopqrstuvwxyz',
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    '23456789',
    '!@#$%^&*-_=+?',
  ];
  const all = sets.join('');
  // Guarantee at least one character from each class, then fill and shuffle.
  const chars = sets.map((set) => set[randomInt(0, set.length)]!);
  while (chars.length < length) chars.push(all[randomInt(0, all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
