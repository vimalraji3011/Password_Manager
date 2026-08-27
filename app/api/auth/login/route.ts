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
import { comparePassword, createSession, findUserByEmail, toSafeUser, users } from '@/lib/auth';
import { LIMITS, rateLimit, resetRateLimit } from '@/lib/rate-limit';
import { fieldErrors, loginSchema } from '@/lib/validation';

/**
 * POST /api/auth/login
 *
 * Verifies credentials against the bcrypt hash and issues an HTTP-only session
 * cookie. Notes on the deliberate choices here:
 *
 *  - Rate limited per IP *and* per email, so neither a single noisy host nor a
 *    distributed guess against one account gets unlimited attempts.
 *  - The failure message never distinguishes "no such user" from "wrong
 *    password" — that difference is a free account-enumeration oracle.
 *  - A failed attempt against a known account is audited; an attempt against an
 *    unknown address is not, so the audit log cannot be flooded with noise.
 */
export const POST = withPublic(async (request) => {
  const ip = clientIp(request);

  const ipLimit = await rateLimit({ key: `login:ip:${ip}`, ...LIMITS.login });
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
  await users.update(user.id, { lastLogin: now, updatedAt: now });

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
