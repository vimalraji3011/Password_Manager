import { clientIp, fail, ok, readBody, userAgent, withPublic } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { PASSWORD_KDF } from '@/lib/password-kdf';
import { hashPassword, users } from '@/lib/auth';
import { findRequestByToken } from '@/lib/reset-flow';
import { LIMITS, rateLimitIp } from '@/lib/rate-limit';
import { resetRequests } from '@/lib/repository';
import { z } from 'zod';
import { fieldErrors, passwordProof } from '@/lib/validation';

/**
 * POST /api/reset-requests/complete
 *
 * Final step of an approved reveal-password reset. The user arrives from the
 * emailed link holding a single-use token and sets a new password.
 *
 * Public by design: the whole point is that the user cannot sign in, so there is
 * no session to authenticate with. The token *is* the authentication — hence the
 * rate limit, the short expiry, and the immediate invalidation below.
 */
const completeSchema = z.object({
  token: z.string().trim().min(10, 'This link is not valid.'),
  // Strength is checked in the browser before derivation; see lib/password-kdf.
  password: passwordProof,
});

export const POST = withPublic(async (request) => {
  const ip = clientIp(request);

  const limit = await rateLimitIp(ip, 'view-reset', LIMITS.otpVerify);
  if (!limit.allowed) {
    return fail(
      `Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      429,
    );
  }

  const parsed = completeSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
  }

  const { token, password } = parsed.data;

  const resetRequest = await findRequestByToken('VIEW_PASSWORD', token);
  if (!resetRequest || resetRequest.status !== 'APPROVED') {
    return fail('This link is invalid or has expired. Ask a System Admin to approve a new request.', 400);
  }

  const user = await users.byId(resetRequest.userId);
  if (!user) return fail('That account no longer exists.', 410);

  await users.update(user.id, {
    // `password` is already the browser-derived proof; bcrypt goes on top.
    passwordHash: await hashPassword(password),
    passwordKdf: PASSWORD_KDF,
    mustChangePassword: false,
    updatedAt: new Date().toISOString(),
  });

  // Clearing the hash is what makes the link genuinely single-use.
  await resetRequests.update(resetRequest.id, {
    status: 'COMPLETED',
    tokenHash: null,
    completedAt: new Date().toISOString(),
  });

  await recordAudit({
    action: 'RESET_COMPLETED',
    actor: { id: user.id, name: user.name, email: user.email },
    ip,
    userAgent: userAgent(request),
    detail: `Reveal-password reset completed (approved by ${resetRequest.decidedBy ?? 'admin'})`,
  });

  return ok({ completed: true, email: user.email });
});
