import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ResetUserPasswordView } from '@/components/resets/reset-user-password-view';
import { getCurrentUser, toSafeUser, users } from '@/lib/auth';

export const metadata: Metadata = { title: 'Reset user password' };

/**
 * Admin-initiated login password reset.
 *
 * Middleware already restricts this route to admins; the check here is the
 * backstop, because the page lists every account in the system.
 */
export default async function ResetUserPasswordPage() {
  const user = await getCurrentUser();
  if (user?.role !== 'admin') redirect('/dashboard?denied=1');

  const all = await users.all();

  return (
    <div>
      <PageHeader
        title="Reset user password"
        description="Email a user a single-use code so they can set a new login password themselves."
      />

      <ResetUserPasswordView
        users={all
          .map(toSafeUser)
          .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))}
        currentUserId={user.id}
      />
    </div>
  );
}
