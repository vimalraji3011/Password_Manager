import { clientIp, fail, ok, readBody, userAgent, withPublic } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { findUserByEmail, hashPassword, users } from '@/lib/auth';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { RESET_FAILURE_MESSAGE, verifyResetToken } from '@/lib/reset-flow';
import { fieldErrors, resetPasswordSchema } from '@/lib/validation';

/**
 * POST /api/auth/reset-password
 *
 * Final step of the forgot-password flow. The OTP is consumed here — verified
 * and invalidated in one atomic step — so a code can never set two passwords.
 *
 * No session is issued on success: the user signs in with the new password,
 * which proves it was stored as intended.
 */
export const POST = withPublic(async (request) => {
  const ip = clientIp(request);

  const limit = rateLimit({ key: `otp:verify:${ip}`, ...LIMITS.otpVerify });
  if (!limit.allowed) {
    return fail(
      `Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      429,
    );
  }

  const parsed = resetPasswordSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
  }

  const { email, otp, password } = parsed.data;
  const user = await findUserByEmail(email);
  if (!user) {
    return fail(RESET_FAILURE_MESSAGE.INVALID, 400, { otp: RESET_FAILURE_MESSAGE.INVALID });
  }

  const result = await verifyResetToken({
    kind: 'LOGIN_PASSWORD',
    userId: user.id,
    token: otp,
    consume: true,
  });

  if (!result.valid) {
    const message = RESET_FAILURE_MESSAGE[result.reason];
    return fail(message, 400, { otp: message });
  }

  await users.update(user.id, {
    passwordHash: await hashPassword(password),
    updatedAt: new Date().toISOString(),
    mustChangePassword: false,
  });

  await recordAudit({
    action: 'RESET_COMPLETED',
    actor: { id: user.id, name: user.name, email: user.email },
    ip,
    userAgent: userAgent(request),
    detail: 'Login password reset via emailed code',
  });

  return ok({ reset: true });
});
