import { clientIp, ok, userAgent, withAuth } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { destroySession } from '@/lib/auth';

/**
 * POST /api/auth/logout
 *
 * Clearing the cookie is the whole logout: the JWT is stateless, so there is no
 * server-side session to invalidate. The audit entry is written before the
 * cookie is dropped, while the actor is still known.
 */
export const POST = withAuth(async ({ request, user }) => {
  await recordAudit({
    action: 'LOGOUT',
    actor: { id: user.id, name: user.name, email: user.email },
    ip: clientIp(request),
    userAgent: userAgent(request),
  });

  await destroySession();
  return ok({ signedOut: true });
});
