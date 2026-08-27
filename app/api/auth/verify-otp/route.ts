import { clientIp, fail, ok, readBody, withPublic } from '@/lib/api';
import { findUserByEmail } from '@/lib/auth';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { RESET_FAILURE_MESSAGE, verifyResetToken } from '@/lib/reset-flow';
import { fieldErrors, verifyOtpSchema } from '@/lib/validation';

/**
 * POST /api/auth/verify-otp
 *
 * Step 2 of the forgot-password flow: confirm the code before asking for a new
 * password, so the user is not made to type a password twice only to be told the
 * code was wrong. The code is checked but not consumed here.
 */
export const POST = withPublic(async (request) => {
  const ip = clientIp(request);

  const limit = await rateLimit({ key: `otp:verify:${ip}`, ...LIMITS.otpVerify });
  if (!limit.allowed) {
    return fail(
      `Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      429,
    );
  }

  const parsed = verifyOtpSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Enter the 6-digit code from your email.', 422, fieldErrors(parsed.error));
  }

  const { email, otp } = parsed.data;
  const user = await findUserByEmail(email);

  // Same generic failure for an unknown address as for a wrong code.
  if (!user) return fail(RESET_FAILURE_MESSAGE.INVALID, 400, { otp: RESET_FAILURE_MESSAGE.INVALID });

  const result = await verifyResetToken({
    kind: 'LOGIN_PASSWORD',
    userId: user.id,
    token: otp,
    consume: false,
  });

  if (!result.valid) {
    const message = RESET_FAILURE_MESSAGE[result.reason];
    return fail(message, 400, { otp: message });
  }

  return ok({ verified: true });
});
