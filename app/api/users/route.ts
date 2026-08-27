import { ok, withAuth } from '@/lib/api';
import { toSafeUser, users } from '@/lib/auth';
import type { SafeUser } from '@/types';

/**
 * GET /api/users
 *
 * Admin only, and always mapped through `toSafeUser` so the bcrypt hash never
 * leaves the server — not even to an admin, who has no use for it.
 */
export const GET = withAuth<SafeUser[]>(
  async () => {
    const all = await users.all();
    return ok(
      all
        .map(toSafeUser)
        .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)),
    );
  },
  { role: 'admin' },
);
