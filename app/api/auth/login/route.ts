import { NextResponse } from 'next/server';
import {
  clientIp,
  fail,
  ok,
  readBody,
  userAgent,
  withPublic,
} from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import {
  comparePassword,
  createSession,
  findUserByEmail,
  hashPassword,
  toSafeUser,
  users,
} from '@/lib/auth';
import { PASSWORD_KDF, derivePasswordProof } from '@/lib/password-kdf';
import { LIMITS, rateLimit, rateLimitIp, resetRateLimit } from '@/lib/rate-limit';
import { fieldErrors, loginSchema } from '@/lib/validation';

/**
 * POST /api/auth/login
 *
 * Verifies credentials against the bcrypt hash and issues an HTTP-only session
 * cookie. Notes on the deliberate choices here:
 *
 *  - Rate limited per IP *and* per email, so neither a single noisy host nor a
 *    distributed guess against one account gets unlimited attempts. The email
 *    bucket is the one that always holds: behind no trusted proxy the IP bucket
 *    stands down rather than key itself on a header the caller controls.
 *  - The failure message never distinguishes "no such user" from "wrong
 *    password" — that difference is a free account-enumeration oracle.
 *  - A failed attempt against a known account is audited; an attempt against an
 *    unknown address is not, so the audit log cannot be flooded with noise.
 */
export const POST = withPublic(async (request) => {
  const ip = clientIp(request);

  const ipLimit = await rateLimitIp(ip, 'login:ip', LIMITS.login);
  if (!ipLimit.allowed) {
    return fail(
      `Too many sign-in attempts. Try again in ${Math.ceil(ipLimit.retryAfter / 60)} minute(s).`,
      429,
    );
  }

  const body = await readBody(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
  }

  const { email, password, remember } = parsed.data;

  const emailLimit = await rateLimit({ key: `login:email:${email}`, ...LIMITS.login });
  if (!emailLimit.allowed) {
    return fail(
      `Too many attempts for this account. Try again in ${Math.ceil(emailLimit.retryAfter / 60)} minute(s).`,
      429,
    );
  }

  const user = await findUserByEmail(email);

  /**
   * What `password` contains depends entirely on the stored record, never on
   * anything the caller claims.
   *
   * A migrated account is holding bcrypt(proof), so only the proof can match; a
   * legacy one is holding bcrypt(password), so only the password can. That
   * makes a downgrade attack a non-event — an attacker who sends the wrong form
   * simply fails the comparison — and it is why no `kdf` field is accepted on
   * this request.
   */
  const legacy = user ? user.passwordKdf !== PASSWORD_KDF : false;
  const valid = user ? await comparePassword(password, user.passwordHash) : false;

  if (!user || !valid) {
    if (user) {
      await recordAudit({
        action: 'LOGIN_FAILED',
        actor: { id: user.id, name: user.name, email: user.email },
        ip,
        userAgent: userAgent(request),
        detail: 'Incorrect password',
      });
    }
    return fail('Incorrect email or password.', 401);
  }

  // Successful sign-in clears the counters so a legitimate user who fat-fingered
  // their password a few times is not left locked out.
  await resetRateLimit(`login:ip:${ip}`);
  await resetRateLimit(`login:email:${email}`);

  const now = new Date().toISOString();

  /**
   * Transparent upgrade.
   *
   * This is the one moment the server legitimately holds the plaintext for a
   * legacy account, so it is the only moment the proof can be computed on its
   * behalf. Derive it, re-bcrypt, and stamp the account as migrated — from the
   * user's side nothing happened beyond a normal sign-in, and from the next
   * sign-in onwards their password stays in their browser.
   *
   * Folded into the same write as `lastLogin` so a crash cannot leave the
   * account half-migrated.
   */
  const upgrade = legacy
    ? {
        passwordHash: await hashPassword(await derivePasswordProof(password, user.email)),
        passwordKdf: PASSWORD_KDF,
      }
    : {};

  await users.update(user.id, { lastLogin: now, updatedAt: now, ...upgrade });

  await createSession(user);

  await recordAudit({
    action: 'LOGIN',
    actor: { id: user.id, name: user.name, email: user.email },
    ip,
    userAgent: userAgent(request),
    detail: remember ? 'Remember me enabled' : undefined,
  });

  return ok({ user: toSafeUser({ ...user, lastLogin: now }) });
});

/** Anything other than POST here is a mistake worth reporting clearly. */
export function GET() {
  return NextResponse.json(
    { ok: false, error: 'Use POST to sign in.' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
