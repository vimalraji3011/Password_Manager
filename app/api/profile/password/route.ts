import { clientIp, fail, ok, readBody, userAgent, withAuth } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { comparePassword, hashPassword, users } from '@/lib/auth';
import { changePasswordSchema, fieldErrors } from '@/lib/validation';

/**
 * POST /api/profile/password
 *
 * Change your own password. Requires the current one, so a hijacked session
 * cannot lock the real owner out of their account.
 *
 * This is also the password used to reveal credentials, so changing it here
 * immediately changes what must be typed in the reveal dialog.
 */
export const POST = withAuth<{ changed: true }>(async ({ request, user }) => {
  const parsed = changePasswordSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
  }

  const { currentPassword, password } = parsed.data;

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    return fail('Your current password is not correct.', 401, {
      currentPassword: 'This does not match your current password.',
    });
  }

  // Reusing the same password is not an error, but it is not a change either.
  if (await comparePassword(password, user.passwordHash)) {
    return fail('Choose a password you have not used here before.', 422, {
      password: 'This is already your current password.',
    });
  }

  await users.update(user.id, {
    passwordHash: await hashPassword(password),
    mustChangePassword: false,
    updatedAt: new Date().toISOString(),
  });

  await recordAudit({
    action: 'RESET_COMPLETED',
    actor: { id: user.id, name: user.name, email: user.email },
    ip: clientIp(request),
    userAgent: userAgent(request),
    detail: 'Login password changed from profile',
  });

  return ok({ changed: true });
});
