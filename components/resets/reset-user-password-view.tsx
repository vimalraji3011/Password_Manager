'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Mail, Send, ShieldAlert, UserCog } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { apiFetch, useMutation } from '@/hooks/use-api';
import { formatDateTime, initials } from '@/lib/utils';
import type { SafeUser } from '@/types';

/**
 * "Reset user password" — the admin-initiated login reset.
 *
 * The admin never picks the new password. They trigger the emailed one-time
 * code and the user sets their own, which keeps the audit log honest: actions
 * recorded against a user really were taken by that user.
 */
export function ResetUserPasswordView({
  users,
  currentUserId,
}: {
  users: SafeUser[];
  currentUserId: number;
}) {
  const [target, setTarget] = React.useState<SafeUser | null>(null);
  const [sentTo, setSentTo] = React.useState<{ email: string; minutes: number } | null>(null);

  const sendReset = useMutation((userId: number) =>
    apiFetch<{ sent: true; email: string; expiresInMinutes: number }>(
      '/api/users/reset-password',
      { method: 'POST', json: { userId } },
    ),
  );

  return (
    <div className="space-y-4">
      {/* Explain what this does before anyone clicks it. */}
      <Card glass>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/12 text-warning">
            <ShieldAlert className="size-5" />
          </span>
          <div>
            <CardTitle className="text-base">How this works</CardTitle>
            <CardDescription className="mt-1.5">
              You do not set the new password yourself. The user receives a 6-digit code by email and
              chooses their own password, so every later action in the audit log remains genuinely
              theirs. Their current password keeps working until they complete the reset.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      {sentTo ? (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-xl border border-success/35 bg-success/8 p-4"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Reset code sent</p>
            <p className="text-sm text-muted-foreground">
              A code was emailed to <span className="font-medium">{sentTo.email}</span>. It expires in{' '}
              {sentTo.minutes} minutes and can be used once.
            </p>
          </div>
        </motion.div>
      ) : null}

      <Card glass>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Select a user to send them a password reset code.</CardDescription>
        </CardHeader>

        <CardContent>
          <ul className="divide-y divide-border/60">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;

              return (
                <li
                  key={user.id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <Avatar className="size-10 shrink-0">
                    <AvatarFallback>{initials(user.name)}</AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{user.name}</span>
                      <Badge variant={user.role === 'admin' ? 'default' : 'neutral'}>
                        {user.role === 'admin' ? 'System Admin' : 'Viewer'}
                      </Badge>
                      {user.mustChangePassword ? (
                        <Badge variant="warning">Reset pending</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Last sign-in: {formatDateTime(user.lastLogin)}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {isSelf ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href="/profile">
                          <UserCog />
                          Change in profile
                        </a>
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTarget(user)}
                        disabled={sendReset.submitting}
                      >
                        <Send />
                        Send reset code
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`Send a reset code to ${target?.name ?? 'this user'}?`}
        confirmLabel="Send reset code"
        tone="caution"
        loading={sendReset.submitting}
        description={
          <>
            A 6-digit code will be emailed to{' '}
            <span className="font-semibold text-foreground">{target?.email}</span>. Their existing
            password continues to work until they complete the reset, and this action is recorded in
            the audit log.
          </>
        }
        onConfirm={async () => {
          if (!target) return;
          const result = await sendReset.run(target.id, {
            successMessage: 'Reset code emailed',
          });
          if (result) {
            setSentTo({ email: result.email, minutes: result.expiresInMinutes });
            setTarget(null);
          }
        }}
      />

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Mail className="mt-0.5 size-3.5 shrink-0" />
        Emails never contain a password — only a single-use code.
      </p>
    </div>
  );
}
