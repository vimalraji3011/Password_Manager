/**
 * Client-side password derivation.
 *
 * Deliberately NOT marked `server-only`: this exact code has to run in the
 * browser and on the server, and the whole scheme falls apart if the two ever
 * compute different bytes.
 *
 * ## What this is for
 *
 * The browser no longer sends the login password. It sends
 * `PBKDF2-SHA256(password, salt = email, 600k iterations)` — the *proof* — and
 * the server bcrypts that before storing it, exactly as it used to bcrypt the
 * password. Two layers, and the server never learns the password itself.
 *
 * ## What it does and does not buy
 *
 * It does **not** stop replay: an attacker who can read the proof off the wire
 * can send it, just as they could have sent an intercepted password. Under a
 * working TLS connection neither is visible, and under a broken one both are.
 * TLS remains the control that matters.
 *
 * What it does buy is that the user's actual password — the one they have
 * probably reused on three other sites — never reaches this server, its access
 * logs, a crash dump, or an APM trace. That is the entire point, and it is worth
 * having.
 *
 * ## Salt choice
 *
 * The salt is derived from the email rather than stored per-user at random.
 * That is what lets any client derive the proof knowing only what the user
 * typed, with no salt lookup before a password *change* and no salt to keep in
 * sync. The cost is that the same email and password produce the same proof on
 * any deployment of this app, so a precomputation attack is theoretically
 * reusable across installs — but it must be run per-email at 600k iterations,
 * which puts it far outside the threat model of an internal vault. Bitwarden
 * makes the same trade for the same reason.
 */

export const PASSWORD_KDF = 'pbkdf2-sha256-v1' as const;

/** Accounts created before client-side derivation shipped. */
export const LEGACY_KDF = 'legacy' as const;

export type PasswordKdf = typeof PASSWORD_KDF | typeof LEGACY_KDF;

/** OWASP's floor for PBKDF2-HMAC-SHA256. Costs roughly half a second in-browser. */
export const PBKDF2_ITERATIONS = 600_000;

/** 32 bytes in, base64 out — 44 characters, comfortably inside bcrypt's 72-byte input limit. */
const DERIVED_BYTES = 32;
const PROOF_LENGTH = 44;

/**
 * Thrown when WebCrypto is unavailable.
 *
 * `crypto.subtle` is exposed only in a secure context, so this fires on a page
 * served over plain HTTP to anything but localhost. Failing loudly is the point:
 * silently posting the raw password instead would quietly undo the entire
 * scheme, and a downgrade an attacker can trigger is worse than no scheme.
 */
export class PasswordKdfUnavailableError extends Error {
  constructor() {
    super(
      'Secure password handling is unavailable. This page must be served over HTTPS ' +
        '(or from localhost) before you can sign in.',
    );
    this.name = 'PasswordKdfUnavailableError';
  }
}

export function kdfSupported(): boolean {
  return typeof globalThis.crypto?.subtle?.deriveBits === 'function';
}

/**
 * UTF-8 bytes in a plain `ArrayBuffer`.
 *
 * `TextEncoder` hands back a `Uint8Array` over an `ArrayBufferLike`, which the
 * WebCrypto typings reject because it might be a `SharedArrayBuffer`. Copying
 * into a concrete buffer satisfies them without a cast.
 */
function toBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

/** The proof is bound to the address, so the same password under two accounts differs. */
function saltFor(email: string): ArrayBuffer {
  return toBuffer(`opm:${PASSWORD_KDF}:${email.trim().toLowerCase()}`);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Derive the value that is sent to the server in place of the password.
 *
 * Identical in the browser and in Node, which is what makes the transparent
 * migration in the login route possible: the server can compute the proof for
 * an account still on the legacy scheme at the one moment it legitimately holds
 * the plaintext.
 */
export async function derivePasswordProof(password: string, email: string): Promise<string> {
  if (!kdfSupported()) throw new PasswordKdfUnavailableError();

  const subtle = globalThis.crypto.subtle;

  const key = await subtle.importKey('raw', toBuffer(password), 'PBKDF2', false, ['deriveBits']);

  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltFor(email),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    DERIVED_BYTES * 8,
  );

  return toBase64(new Uint8Array(bits));
}

/** Shape check for a value claiming to be a proof. Not a security control — just input hygiene. */
export function looksLikeProof(value: string): boolean {
  return value.length === PROOF_LENGTH && /^[A-Za-z0-9+/]{43}=$/.test(value);
}

/**
 * Password policy.
 *
 * This now has to be enforced in the browser, because the server only ever sees
 * a 44-character proof and cannot tell `password1` from a passphrase. A modified
 * client can therefore skip it — an unavoidable consequence of client-side
 * hashing, and an accepted one here: the people who could bypass it are the two
 * staff members who already hold admin credentials to the vault.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Returns an error message, or null when the password is acceptable. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`;
  }
  if (!/[a-z]/.test(password)) return 'Include at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter';
  if (!/\d/.test(password)) return 'Include at least one number';
  return null;
}
