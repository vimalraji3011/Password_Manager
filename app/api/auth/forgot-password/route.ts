import { clientIp, fail, ok, readBody, userAgent, withPublic } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { findUserByEmail } from '@/lib/auth';
import { generateOtp, hashToken } from '@/lib/crypto';
import { sendMail, templates } from '@/lib/mailer';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { resetRequests } from '@/lib/repository';
import { OTP_TTL_MINUTES } from '@/lib/constants';
import { fieldErrors, forgotPasswordSchema } from '@/lib/validation';

/**
 * POST /api/auth/forgot-password
 *
 * Issues a one-time code for a login-password reset.
 *
 * The response is identical whether or not the address exists — an attacker must
 * not be able to use this endpoint to discover who has an account. Any earlier
 * pending request for the same user is superseded, so only the newest code ever
 * works.
 */
export const POST = withPublic(async (request) => {
  const ip = clientIp(request);

  const limit = await rateLimit({ key: `otp:request:${ip}`, ...LIMITS.otpRequest });
  if (!limit.allowed) {
    return fail(
      `Too many reset requests. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      429,
    );
  }

  const parsed = forgotPasswordSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Please enter a valid email address.', 422, fieldErrors(parsed.error));
  }

  const { email } = parsed.data;
  const user = await findUserByEmail(email);

  // Deliberately the same shape and timing-insensitive path for unknown users.
  if (!user) {
    return ok({ sent: true, expiresInMinutes: OTP_TTL_MINUTES });
  }

  // Retire any code already outstanding for this account.
  const pending = await resetRequests.filter(
    (item) =>
      item.userId === user.id && item.kind === 'LOGIN_PASSWORD' && item.status === 'PENDING',
  );
  for (const item of pending) {
    await resetRequests.update(item.id, { status: 'EXPIRED' });
  }

  const otp = generateOtp();
  const now = new Date();

  await resetRequests.insert({
    kind: 'LOGIN_PASSWORD',
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    status: 'PENDING',
    tokenHash: hashToken(otp),
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000).toISOString(),
    attempts: 0,
    requestedAt: now.toISOString(),
  });

  await sendMail(templates.loginOtp(user.email, user.name, otp, OTP_TTL_MINUTES));

  await recordAudit({
    action: 'RESET_REQUESTED',
    actor: { id: user.id, name: user.name, email: user.email },
    ip,
    userAgent: userAgent(request),
    detail: 'Login password reset code requested',
  });

  return ok({ sent: true, expiresInMinutes: OTP_TTL_MINUTES });
});
