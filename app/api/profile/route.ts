import { clientIp, fail, ok, readBody, userAgent, withAuth } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { toSafeUser, users } from '@/lib/auth';
import { fieldErrors, profileSchema } from '@/lib/validation';
import type { SafeUser } from '@/types';

/**
 * PATCH /api/profile
 *
 * Self-service edit of name and mobile. Email and role are deliberately not
 * editable here: the email is the login identity and the role is the permission
 * boundary, so neither should be changeable by the account itself.
 */
export const PATCH = withAuth<SafeUser>(async ({ request, user }) => {
  const parsed = profileSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
  }

  const updated = await users.update(user.id, {
    name: parsed.data.name,
    mobile: parsed.data.mobile,
    updatedAt: new Date().toISOString(),
  });

  if (!updated) return fail('Your account could not be found.', 404);

  await recordAudit({
    action: 'PROFILE_UPDATED',
    actor: { id: user.id, name: updated.name, email: user.email },
    ip: clientIp(request),
    userAgent: userAgent(request),
    detail: 'Name or mobile number updated',
  });

  return ok(toSafeUser(updated));
});
