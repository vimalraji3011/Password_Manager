import { fail, ok, readBody, withPublic } from '@/lib/api';
import { findUserByEmail } from '@/lib/auth';
import { LEGACY_KDF, PASSWORD_KDF, PBKDF2_ITERATIONS } from '@/lib/password-kdf';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { fieldErrors, preloginSchema } from '@/lib/validation';

/**
 * POST /api/auth/prelogin
 *
 * Tells the browser how to prepare the credential for a given address, before
 * any password is typed. Two answers are possible:
 *
 *  - `pbkdf2-sha256-v1` — derive the proof and send that.
 *  - `legacy` — this account has not been migrated yet, so send the password
 *    itself one last time. The login route upgrades it on the way through.
 *
 * ## The enumeration trade-off
 *
 * An unknown address gets the same answer a migrated account does, so the
 * endpoint cannot be used to test whether an email has an account. The one
 * residual signal is that a *legacy* account answers differently, which marks
 * an address as "exists and has not signed in since the upgrade". That window
 * closes the first time each user signs in, and closing it entirely is not
 * possible: a transparent migration means the server must tell the client which
 * of two credentials to send. Rate limiting keeps it from being swept at speed.
 */
export const POST = withPublic(async (request) => {
  const parsed = preloginSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Enter a valid email address.', 422, fieldErrors(parsed.error));
  }

  const { email } = parsed.data;

  // Keyed on the address, which is the thing being probed.
  const limit = await rateLimit({ key: `prelogin:${email}`, ...LIMITS.prelogin });
  if (!limit.allowed) {
    return fail(
      `Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      429,
    );
  }

  const user = await findUserByEmail(email);

  // No account, or an already-migrated one: identical response either way.
  const kdf = user && user.passwordKdf !== PASSWORD_KDF ? LEGACY_KDF : PASSWORD_KDF;

  return ok({ kdf, iterations: PBKDF2_ITERATIONS });
});
