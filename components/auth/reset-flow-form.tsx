'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Mail, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { ApiError, apiFetch, useMutation } from '@/hooks/use-api';
import { derivePasswordProof, passwordPolicyError } from '@/lib/password-kdf';
import { useCountdown } from '@/hooks/use-countdown';
import { cn } from '@/lib/utils';

/**
 * The forgot-password flow, as a three-step wizard:
 *
 *   1. email     — request a one-time code
 *   2. otp       — confirm the code (checked, not consumed)
 *   3. password  — set a new password (consumes the code)
 *   4. done      — confirmation
 *
 * Steps live in local state rather than in the URL: a half-finished password
 * reset is not something a user should be able to bookmark, share or land on
 * via the Back button.
 *
 * Shared by /forgot-password and /reset-password — the latter starts at step 2
 * because the user arrived from an email that already contains their address.
 */

type Step = 'email' | 'otp' | 'password' | 'done';

const RESEND_COOLDOWN_SECONDS = 45;

export function ResetFlowForm({
  initialEmail = '',
  initialStep = 'email',
  /** Copy differs slightly when a System Admin started the reset. */
  adminInitiated = false,
}: {
  initialEmail?: string;
  initialStep?: Step;
  adminInitiated?: boolean;
}) {
  const router = useRouter();

  const [step, setStep] = React.useState<Step>(initialStep);
  const [email, setEmail] = React.useState(initialEmail);
  const [otp, setOtp] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  const cooldown = useCountdown(RESEND_COOLDOWN_SECONDS);

  const requestCode = useMutation((input: { email: string }) =>
    apiFetch<{ sent: boolean; expiresInMinutes: number }>('/api/auth/forgot-password', {
      method: 'POST',
      json: input,
    }),
  );

  const verifyCode = useMutation((input: { email: string; otp: string }) =>
    apiFetch<{ verified: boolean }>('/api/auth/verify-otp', { method: 'POST', json: input }),
  );

  const submitPassword = useMutation(
    async (input: { email: string; otp: string; password: string; confirmPassword: string }) => {
      if (input.password !== input.confirmPassword) {
        throw new ApiError('Please correct the highlighted fields.', 422, {
          confirmPassword: 'Passwords do not match',
        });
      }

      // Strength has to be judged before derivation — afterwards it is 44
      // characters of base64 and unreadable to anyone, this app included.
      const policy = passwordPolicyError(input.password);
      if (policy) {
        throw new ApiError('Please correct the highlighted fields.', 422, { password: policy });
      }

      return apiFetch<{ reset: boolean }>('/api/auth/reset-password', {
        method: 'POST',
        json: {
          email: input.email,
          otp: input.otp,
          password: await derivePasswordProof(input.password, input.email),
        },
      });
    },
  );

  async function onRequestCode(event: React.FormEvent) {
    event.preventDefault();
    await requestCode.run(
      { email },
      {
        onSuccess: (result) => {
          toast.success(
            `If that address has an account, a code is on its way. It expires in ${result.expiresInMinutes} minutes.`,
          );
          setStep('otp');
          cooldown.start();
        },
      },
    );
  }

  async function onResend() {
    if (cooldown.running) return;
    await requestCode.run(
      { email },
      {
        onSuccess: () => {
          toast.success('A new code has been sent.');
          setOtp('');
          cooldown.start();
        },
      },
    );
  }

  async function onVerifyCode(event: React.FormEvent) {
    event.preventDefault();
    await verifyCode.run({ email, otp }, { onSuccess: () => setStep('password') });
  }

  async function onSubmitPassword(event: React.FormEvent) {
    event.preventDefault();
    await submitPassword.run(
      { email, otp, password, confirmPassword },
      {
        onSuccess: () => {
          cooldown.stop();
          setStep('done');
        },
        onError: (error) => {
          // The code was rejected at the final step (expired while typing, say);
          // send them back rather than leaving a dead form on screen.
          if (error.fields?.otp) setStep('otp');
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <StepIndicator step={step} />

      <AnimatePresence mode="wait" initial={false}>
        {step === 'email' ? (
          <StepPane key="email">
            <form onSubmit={onRequestCode} className="space-y-5" noValidate>
              <Field label="Work email" htmlFor="reset-email" required error={requestCode.fieldErrors.email}>
                <Input
                  id="reset-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="you@company.com"
                  icon={<Mail />}
                  value={email}
                  invalid={Boolean(requestCode.fieldErrors.email)}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Button
                type="submit"
                variant="gradient"
                size="lg"
                className="w-full"
                loading={requestCode.submitting}
              >
                Send verification code
                {requestCode.submitting ? null : <ArrowRight />}
              </Button>
            </form>
          </StepPane>
        ) : null}

        {step === 'otp' ? (
          <StepPane key="otp">
            <form onSubmit={onVerifyCode} className="space-y-5" noValidate>
              <p className="rounded-lg border border-border/70 bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">
                {adminInitiated
                  ? 'A System Admin started a password reset for your account. Enter the 6-digit code from the email sent to'
                  : 'Enter the 6-digit code we sent to'}{' '}
                <span className="font-medium text-foreground">{email}</span>.
              </p>

              <Field
                label="Verification code"
                htmlFor="otp"
                required
                error={verifyCode.fieldErrors.otp}
                hint="The code expires 10 minutes after it was sent."
              >
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  icon={<KeyRound />}
                  className="font-mono text-lg tracking-[0.55em]"
                  value={otp}
                  invalid={Boolean(verifyCode.fieldErrors.otp)}
                  // Strip anything that is not a digit so a pasted code still works.
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </Field>

              <Button
                type="submit"
                variant="gradient"
                size="lg"
                className="w-full"
                loading={verifyCode.submitting}
                disabled={otp.length !== 6}
              >
                Verify code
                {verifyCode.submitting ? null : <ArrowRight />}
              </Button>

              <div className="flex items-center justify-between gap-3 text-sm">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep('email')}
                  className="text-muted-foreground"
                >
                  <ArrowLeft />
                  Change email
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onResend}
                  disabled={cooldown.running || requestCode.submitting}
                  className="text-muted-foreground"
                >
                  <RotateCcw />
                  {cooldown.running ? `Resend in ${cooldown.remaining}s` : 'Resend code'}
                </Button>
              </div>
            </form>
          </StepPane>
        ) : null}

        {step === 'password' ? (
          <StepPane key="password">
            <form onSubmit={onSubmitPassword} className="space-y-5" noValidate>
              <Field
                label="New password"
                htmlFor="new-password"
                required
                error={submitPassword.fieldErrors.password}
                hint="At least 8 characters, with upper and lower case letters and a number."
              >
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  autoFocus
                  placeholder="Choose a strong password"
                  showStrength
                  value={password}
                  invalid={Boolean(submitPassword.fieldErrors.password)}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              <Field
                label="Confirm new password"
                htmlFor="confirm-password"
                required
                error={submitPassword.fieldErrors.confirmPassword}
              >
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  placeholder="Re-enter the password"
                  value={confirmPassword}
                  invalid={Boolean(submitPassword.fieldErrors.confirmPassword)}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>

              <Button
                type="submit"
                variant="gradient"
                size="lg"
                className="w-full"
                loading={submitPassword.submitting}
              >
                Update password
              </Button>
            </form>
          </StepPane>
        ) : null}

        {step === 'done' ? (
          <StepPane key="done">
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
                  Sign in with your new password. The verification code has been invalidated.
                </p>
              </div>

              <Button
                variant="gradient"
                size="lg"
                className="w-full"
                onClick={() => router.push('/login')}
              >
                Go to sign in
                <ArrowRight />
              </Button>
            </div>
          </StepPane>
        ) : null}
      </AnimatePresence>

      {step !== 'done' ? (
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Slide-and-fade wrapper so steps feel like a wizard, not a page reload. */
function StepPane({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'email', label: 'Email' },
  { key: 'otp', label: 'Verify' },
  { key: 'password', label: 'New password' },
];

function StepIndicator({ step }: { step: Step }) {
  const activeIndex = step === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === step);

  return (
    <ol className="flex items-center gap-2" aria-label="Reset progress">
      {STEPS.map((item, index) => {
        const complete = index < activeIndex;
        const current = index === activeIndex;

        return (
          <li key={item.key} className="flex flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  initial={false}
                  animate={{ width: complete || current ? '100%' : '0%' }}
                  transition={{ duration: 0.35 }}
                  className={cn(
                    'h-full rounded-full',
                    complete ? 'bg-success' : 'bg-gradient-to-r from-indigo-500 to-violet-500',
                  )}
                />
              </div>
              <span
                className={cn(
                  'truncate text-[11px] font-medium',
                  current ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
