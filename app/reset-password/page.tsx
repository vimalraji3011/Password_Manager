import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetFlowForm } from '@/components/auth/reset-flow-form';

export const metadata: Metadata = { title: 'Set a new password' };

/**
 * Landing page for the link in an admin-initiated reset email.
 *
 * The address arrives in the query string, so the flow can skip straight to the
 * code step. If it is missing the wizard simply starts from the beginning.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const initialEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  return (
    <AuthShell
      title="Set a new password"
      subtitle={
        initialEmail
          ? 'Enter the code from your email, then choose a new password.'
          : 'Confirm your email address to receive a one-time code.'
      }
    >
      <ResetFlowForm
        initialEmail={initialEmail}
        initialStep={initialEmail ? 'otp' : 'email'}
        adminInitiated={Boolean(initialEmail)}
      />
    </AuthShell>
  );
}
