import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyResetForm } from '@/components/resets/verify-reset-form';
import { findEmailByToken } from '@/lib/reset-flow';

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
  const value = typeof token === 'string' ? token : '';

  /**
   * Resolve the address the token belongs to.
   *
   * The browser derives the new password under this address as salt, so it has
   * to come from the token rather than from anything the visitor can edit.
   * Null simply means the link is invalid or expired, and the form already
   * knows how to say so.
   */
  const email = await findEmailByToken('VIEW_PASSWORD', value);

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Your request was approved. Choose a new password below — this link works only once."
    >
      <VerifyResetForm token={email ? value : ''} email={email ?? ''} />
    </AuthShell>
  );
}
