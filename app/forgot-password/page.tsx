import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetFlowForm } from '@/components/auth/reset-flow-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a one-time code to confirm it is really you."
    >
      <ResetFlowForm />
    </AuthShell>
  );
}
