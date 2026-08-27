import { clientIp, fail, ok, readBody, userAgent, withPublic } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { hashPassword, users } from '@/lib/auth';
import { findRequestByToken } from '@/lib/reset-flow';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { resetRequests } from '@/lib/repository';
import { z } from 'zod';
import { fieldErrors } from '@/lib/validation';

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
const completeSchema = z
  .object({
    token: z.string().trim().min(10, 'This link is not valid.'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be 128 characters or fewer')
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/\d/, 'Include at least one number'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const POST = withPublic(async (request) => {
  const ip = clientIp(request);

  const limit = await rateLimit({ key: `view-reset:${ip}`, ...LIMITS.otpVerify });
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
    passwordHash: await hashPassword(password),
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
