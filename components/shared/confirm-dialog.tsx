'use client';

import * as React from 'react';
import { AlertTriangle, ShieldQuestion } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Reusable confirmation for actions worth pausing on.
 *
 * Two tones, because not every confirmation is a deletion: `danger` for
 * irreversible destruction, `caution` for sensitive-but-recoverable actions such
 * as emailing someone a reset code. Using a red "Delete"-styled button for the
 * latter would train people to ignore red buttons.
 *
 * When `confirmText` is supplied the user must retype it before the action
 * unlocks. That friction is reserved for cascading deletes, where a misclick
 * would take credentials down with the parent record.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  confirmText,
  tone = 'danger',
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  confirmText?: string;
  tone?: 'danger' | 'caution';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = React.useState('');

  // Clear the challenge whenever the dialog closes, so reopening starts fresh.
  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const unlocked = !confirmText || typed.trim() === confirmText;
  const isDanger = tone === 'danger';
  const Icon = isDanger ? AlertTriangle : ShieldQuestion;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div
            className={cn(
              'mx-auto flex size-11 items-center justify-center rounded-xl sm:mx-0',
              isDanger ? 'bg-destructive/12 text-destructive' : 'bg-warning/12 text-warning',
            )}
          >
            <Icon className="size-5" />
          </div>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {confirmText ? (
          <div className="mt-4 space-y-2">
            <Label htmlFor="confirm-text" className="text-xs font-normal text-muted-foreground">
              Type <span className="font-semibold text-foreground">{confirmText}</span> to confirm
            </Label>
            <Input
              id="confirm-text"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              placeholder={confirmText}
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!unlocked || loading}
            className={cn(!isDanger && buttonVariants({ variant: 'default' }))}
            // Keep the dialog mounted while the request runs so the button can
            // show its pending state instead of vanishing mid-flight.
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
          >
            {loading ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
