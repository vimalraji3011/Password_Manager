'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { apiFetch, useMutation } from '@/hooks/use-api';

/**
 * Completes an approved reveal-password reset.
 *
 * The token comes from the query string, is never displayed, and is exchanged
 * for a password change in a single request. A missing token short-circuits to
 * an explanation rather than showing a form that cannot possibly succeed.
 */
export function VerifyResetForm({ token }: { token: string }) {
  const router = useRouter();

  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [done, setDone] = React.useState(false);

  const complete = useMutation(
    (input: { token: string; password: string; confirmPassword: string }) =>
      apiFetch<{ completed: true; email: string }>('/api/reset-requests/complete', {
        method: 'POST',
        json: input,
      }),
  );

  if (!token) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/12 text-destructive">
          <AlertTriangle className="size-7" />
        </div>
        <div className="space-y-1.5">
          <p className="text-lg font-semibold">This link is incomplete</p>
          <p className="text-sm text-muted-foreground">
            Open the link exactly as it appears in your approval email. If it has expired, raise a
            new request and a System Admin can approve it again.
          </p>
        </div>
        <Button variant="outline" className="w-full" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-5 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success/12 text-success"
        >
          <CheckCircle2 className="size-7" />
        </motion.div>

        <div className="space-y-1.5">
          <p className="text-lg font-semibold">Password updated</p>
          <p className="text-sm text-muted-foreground">
            Use your new password to sign in, and to confirm your identity the next time you reveal a
            credential. This link has now been invalidated.
          </p>
        </div>

        <Button variant="gradient" size="lg" className="w-full" onClick={() => router.push('/login')}>
          Go to sign in
          <ArrowRight />
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        await complete.run(
          { token, password, confirmPassword },
          { onSuccess: () => setDone(true) },
        );
      }}
    >
      <Field
        label="New password"
        htmlFor="verify-password"
        required
        error={complete.fieldErrors.password}
        hint="At least 8 characters, with upper and lower case letters and a number."
      >
        <PasswordInput
          id="verify-password"
          autoFocus
          autoComplete="new-password"
          placeholder="Choose a strong password"
          showStrength
          value={password}
          invalid={Boolean(complete.fieldErrors.password)}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Field
        label="Confirm new password"
        htmlFor="verify-confirm"
        required
        error={complete.fieldErrors.confirmPassword}
      >
        <PasswordInput
          id="verify-confirm"
          autoComplete="new-password"
          placeholder="Re-enter the password"
          value={confirmPassword}
          invalid={Boolean(complete.fieldErrors.confirmPassword)}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </Field>

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        className="w-full"
        loading={complete.submitting}
        disabled={!password || !confirmPassword}
      >
        Update password
      </Button>

      <p className="text-center text-sm">
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
