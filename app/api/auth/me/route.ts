import { ok, withAuth } from '@/lib/api';
import { toSafeUser } from '@/lib/auth';

/**
 * GET /api/auth/me
 *
 * Returns the signed-in user, resolved from the datastore rather than from the
 * token, so a role change takes effect on the next request instead of on the
 * next sign-in.
 */
export const GET = withAuth(async ({ user }) => ok({ user: toSafeUser(user) }));
