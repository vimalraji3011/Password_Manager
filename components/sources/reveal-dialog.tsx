'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Eye, Lock, ShieldCheck, TimerReset } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { apiFetch, useMutation } from '@/hooks/use-api';
import { useCountdown } from '@/hooks/use-countdown';
import { derivePasswordProof } from '@/lib/password-kdf';
import type { SafeSource } from '@/types';

interface RevealResult {
  password: string;
  visibleForSeconds: number;
  source: string;
  organization: string;
}

/**
 * Reveal-password modal.
 *
 * The flow is deliberately two-stage: confirm your own login password, then see
 * the credential for a fixed countdown. When the timer expires the plaintext is
 * dropped from React state — not merely hidden with CSS — so it is no longer
 * anywhere in the component tree.
 *
 * Closing the dialog clears it immediately, and the value is never written to
 * `localStorage`, the URL, or anywhere else that outlives the modal.
 */
export function RevealDialog({
  source,
  email,
  open,
  onOpenChange,
}: {
  source: SafeSource | null;
  /** The signed-in user's address — the salt the re-auth proof is derived under. */
  email: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = React.useState('');
  const [revealed, setRevealed] = React.useState<RevealResult | null>(null);

  const countdown = useCountdown(10, {
    // Drop the secret the moment the countdown ends.
    onComplete: () => setRevealed(null),
  });

  const reveal = useMutation(async (input: { id: number; password: string }) => {
    // Same derivation as sign-in: the re-auth password never leaves the browser
    // either, or the reveal step would quietly reintroduce what login removed.
    const proof = await derivePasswordProof(input.password, email);

    return apiFetch<RevealResult>(`/api/sources/${input.id}/reveal`, {
      method: 'POST',
      json: { password: proof },
    });
  });

  // `stop` is a stable useCallback, so pulling it out of the object keeps
  // the effect from re-running on every render of this component.
  const { stop: stopCountdown } = countdown;

  // Wipe everything whenever the dialog closes.
  React.useEffect(() => {
    if (!open) {
      setPassword('');
      setRevealed(null);
      stopCountdown();
    }
  }, [open, stopCountdown]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!source) return;

    await reveal.run(
      { id: source.id, password },
      {
        onSuccess: (result) => {
          setRevealed(result);
          // Never keep the login password around once it has done its job.
          setPassword('');
          countdown.start(result.visibleForSeconds);
        },
      },
    );
  }

  const progress = revealed ? (countdown.remaining / revealed.visibleForSeconds) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-warning/12 text-warning">
            <Eye className="size-5" />
          </div>
          <DialogTitle>Reveal {source?.source ?? 'credential'}</DialogTitle>
          <DialogDescription>
            {revealed
              ? 'This password hides automatically. Copy it now if you need it.'
              : 'Confirm your own login password. This reveal is recorded in the audit log and other System Admins are notified.'}
          </DialogDescription>
        </DialogHeader>

        {revealed ? (
          <>
            <DialogBody className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {revealed.organization} · {revealed.source}
                </p>

                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-3">
                  {/*
                    `break-all` so a long generated password wraps inside the
                    box instead of forcing the dialog to scroll sideways.
                  */}
                  <code className="credential min-w-0 flex-1 select-all break-all text-base">
                    {revealed.password}
                  </code>
                  <CopyButton
                    value={revealed.password}
                    label="Copy password"
                    successMessage="Password copied. It stays on your clipboard until you copy something else."
                    variant="secondary"
                    size="icon-sm"
                    confirm={{
                      title: 'Copy this password to the clipboard?',
                      description: (
                        <>
                          The clipboard is shared with every app on this machine and is not
                          cleared when the 10-second countdown ends. Paste it where you need it,
                          then copy something else to displace it.
                        </>
                      ),
                      confirmLabel: 'Copy password',
                    }}
                  />
                </div>
              </div>

              {/* Countdown */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <TimerReset className="size-3.5" />
                    Hiding automatically
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {countdown.remaining}s
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    initial={{ width: '100%' }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 1, ease: 'linear' }}
                    className="h-full rounded-full bg-gradient-to-r from-warning to-destructive"
                  />
                </div>
              </div>
            </DialogBody>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <DialogBody className="space-y-4">
              <Field
                label="Your login password"
                htmlFor="reveal-password"
                required
                error={reveal.fieldErrors.password}
              >
                <PasswordInput
                  id="reveal-password"
                  autoFocus
                  autoComplete="current-password"
                  placeholder="Enter your login password"
                  icon={<Lock />}
                  value={password}
                  invalid={Boolean(reveal.fieldErrors.password)}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>

              <p className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Credentials are stored encrypted with AES-256-GCM and decrypted only for this
                  request. The value is shown for 10 seconds and never cached.
                </span>
              </p>
            </DialogBody>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={reveal.submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="gradient"
                loading={reveal.submitting}
                disabled={password.length === 0}
              >
                <Eye />
                Reveal password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
