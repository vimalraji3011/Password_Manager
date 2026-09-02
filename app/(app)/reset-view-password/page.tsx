import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ResetViewPasswordView } from '@/components/resets/reset-view-password-view';
import { getCurrentUser } from '@/lib/auth';
import { resetRequests } from '@/lib/repository';

export const metadata: Metadata = { title: 'Reset view password' };

/**
 * Reveal-password reset: request form for everyone, approval queue for admins.
 *
 * Available to viewers as well as admins — a viewer cannot reveal credentials,
 * but they can still be locked out of their own account, and this is where they
 * ask for help.
 */
export default async function ResetViewPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const all = await resetRequests.filter((item) => item.kind === 'VIEW_PASSWORD');

  // Admins approve, so they see everything; everyone else sees only their own.
  const visible = user.role === 'admin' ? all : all.filter((item) => item.userId === user.id);

  visible.sort((a, b) => {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
    if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
    return b.requestedAt.localeCompare(a.requestedAt);
  });

  return (
    <div>
      <PageHeader
        title="Reset view password"
        description={
          user.role === 'admin'
            ? 'Approve or reject requests from users who can no longer confirm their password when revealing a credential.'
            : 'Ask a System Admin to reset the password you confirm before revealing a credential.'
        }
      />

      {/* tokenHash must never reach the browser — strip it here as well as in the API. */}
      <ResetViewPasswordView
        initialRequests={visible.map(({ tokenHash: _tokenHash, ...rest }) => rest)}
        role={user.role}
        currentUserId={user.id}
      />
    </div>
  );
}
