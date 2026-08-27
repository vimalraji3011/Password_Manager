import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { MustChangePasswordBanner } from '@/components/layout/must-change-password-banner';
import { RouteNotices } from '@/components/layout/route-notices';
import { getCurrentUser, toSafeUser } from '@/lib/auth';

/**
 * Layout for every authenticated page.
 *
 * The `(app)` route group shares this chrome without adding a URL segment, so
 * the paths stay exactly as specified (/dashboard, /organizations, …).
 *
 * Middleware has already rejected anonymous requests; the check here is the
 * backstop that also catches a token for a user who no longer exists.
 */
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <AppShell user={toSafeUser(user)}>
      {/* Reads query flags, so it needs its own boundary. Renders nothing. */}
      <Suspense fallback={null}>
        <RouteNotices />
      </Suspense>

      {user.mustChangePassword ? <MustChangePasswordBanner email={user.email} /> : null}

      {children}
    </AppShell>
  );
}
