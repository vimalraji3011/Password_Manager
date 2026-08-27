import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyResetForm } from '@/components/resets/verify-reset-form';

export const metadata: Metadata = { title: 'Set a new password' };

/**
 * Landing page for the single-use link in an approved reveal-password reset.
 *
 * Deliberately outside the `(app)` route group: it authenticates with the token
 * from the email rather than with the session cookie, and it must render without
 * the app shell whether or not the visitor happens to be signed in. Middleware
 * lists this path under `TOKEN_PATHS` so it is never redirected either way.
 */
export default async function VerifyResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Your request was approved. Choose a new password below — this link works only once."
    >
      <VerifyResetForm token={typeof token === 'string' ? token : ''} />
    </AuthShell>
  );
}
