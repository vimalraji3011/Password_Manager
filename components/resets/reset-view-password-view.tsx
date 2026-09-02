'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock3,
  Info,
  KeyRound,
  Send,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { apiFetch, useMutation } from '@/hooks/use-api';
import { VIEW_RESET_TTL_MINUTES } from '@/lib/constants';
import { formatDateTime, relativeTime } from '@/lib/utils';
import type { ResetRequest, ResetRequestStatus, Role } from '@/types';

/**
 * "Reset view password" — approval queue and request form.
 *
 * The same page serves both sides of the workflow:
 *  - anyone can raise a request for themselves
 *  - a System Admin additionally sees the queue and can approve or reject
 *
 * Why approval is required at all: the password that unlocks a reveal is the
 * user's own login password, so a self-service reset would let whoever holds a
 * hijacked session mint themselves a new one. A human in the loop is the point.
 */

const STATUS_META: Record<ResetRequestStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING: { label: 'Awaiting approval', tone: 'warning' },
  APPROVED: { label: 'Approved — link sent', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

export function ResetViewPasswordView({
  initialRequests,
  role,
  currentUserId,
}: {
  initialRequests: ResetRequest[];
  role: Role;
  currentUserId: number;
}) {
  const router = useRouter();
  const isAdmin = role === 'admin';

  const [requests, setRequests] = React.useState(initialRequests);
  const [reason, setReason] = React.useState('');
  const [deciding, setDeciding] = React.useState<{
    request: ResetRequest;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);

  const refresh = React.useCallback(async () => {
    setRequests(await apiFetch<ResetRequest[]>('/api/reset-requests'));
    router.refresh();
  }, [router]);

  const createRequest = useMutation((input: { reason: string }) =>
    apiFetch<ResetRequest>('/api/reset-requests', { method: 'POST', json: input }),
  );

  const decide = useMutation((input: { id: number; decision: 'APPROVED' | 'REJECTED' }) =>
    apiFetch<ResetRequest>(`/api/reset-requests/${input.id}/decide`, {
      method: 'POST',
      json: { decision: input.decision },
    }),
  );

  const myOpenRequest = requests.find(
    (item) => item.userId === currentUserId && item.status === 'PENDING',
  );
  const pending = requests.filter((item) => item.status === 'PENDING');
  const history = requests.filter((item) => item.status !== 'PENDING');

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Request form */}
      <div className="space-y-4 lg:col-span-1">
        <Card glass>
          <CardHeader>
            <CardTitle>Request a reset</CardTitle>
            <CardDescription>
              Use this if you can no longer confirm your password when revealing a credential. A
              System Admin approves the request, then you receive a single-use link valid for{' '}
              {VIEW_RESET_TTL_MINUTES} minutes.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {myOpenRequest ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/8 p-3.5"
              >
                <Clock3 className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Waiting for approval</p>
                  <p className="text-sm text-muted-foreground">
                    Requested {relativeTime(myOpenRequest.requestedAt)}. You will get an email as
                    soon as a System Admin decides.
                  </p>
                </div>
              </motion.div>
            ) : (
              <form
                className="space-y-4"
                noValidate
                onSubmit={async (event) => {
                  event.preventDefault();
                  await createRequest.run(
                    { reason },
                    {
                      successMessage: 'Request sent to the System Admin',
                      onSuccess: async () => {
                        setReason('');
                        await refresh();
                      },
                    },
                  );
                }}
              >
                <Field
                  label="Reason"
                  htmlFor="reset-reason"
                  error={createRequest.fieldErrors.reason}
                  hint="Optional, but it helps the approver decide quickly."
                >
                  <Textarea
                    id="reset-reason"
                    placeholder="I can no longer confirm my password when revealing credentials."
                    maxLength={500}
                    value={reason}
                    invalid={Boolean(createRequest.fieldErrors.reason)}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>

                <Button
                  type="submit"
                  variant="gradient"
                  className="w-full"
                  loading={createRequest.submitting}
                >
                  <Send />
                  Send request
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card glass>
          <CardContent className="pt-6">
            <p className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                The password you confirm before a reveal is your own login password. Resetting it
                here changes both. Credentials themselves are never affected — they stay encrypted
                with the server key.
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Queue + history */}
      <div className="space-y-4 lg:col-span-2">
        {isAdmin ? (
          <Card glass>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Awaiting your approval</CardTitle>
                <CardDescription className="mt-1">
                  Approving emails the requester a single-use link. You never see the link yourself.
                </CardDescription>
              </div>
              {pending.length > 0 ? <Badge variant="warning">{pending.length}</Badge> : null}
            </CardHeader>

            <CardContent>
              {pending.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck />}
                  title="Nothing to approve"
                  description="Reveal-password reset requests will appear here."
                  className="py-10"
                />
              ) : (
                <ul className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {pending.map((request) => (
                      <motion.li
                        key={request.id}
                        id={`request-${request.id}`}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        className="rounded-xl border border-border bg-background/40 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{request.userName}</p>
                            <p className="truncate text-sm text-muted-foreground">
                              {request.userEmail}
                            </p>
                          </div>
                          <Badge variant="warning">{STATUS_META.PENDING.label}</Badge>
                        </div>

                        {request.reason ? (
                          <p className="mt-3 rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">
                            {request.reason}
                          </p>
                        ) : (
                          <p className="mt-3 text-sm italic text-muted-foreground">
                            No reason provided.
                          </p>
                        )}

                        <p className="mt-3 text-xs text-muted-foreground">
                          Requested {formatDateTime(request.requestedAt)}
                        </p>

                        <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeciding({ request, decision: 'REJECTED' })}
                            disabled={decide.submitting}
                          >
                            <ThumbsDown />
                            Reject
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => setDeciding({ request, decision: 'APPROVED' })}
                            disabled={decide.submitting}
                          >
                            <ThumbsUp />
                            Approve and email link
                          </Button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card glass>
          <CardHeader>
            <CardTitle>{isAdmin ? 'Request history' : 'Your requests'}</CardTitle>
            <CardDescription>
              {isAdmin
                ? 'Every decided request, newest first.'
                : 'Requests you have raised and what happened to them.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {history.length === 0 ? (
              <EmptyState
                icon={<KeyRound />}
                title="No history yet"
                description="Decided requests will be listed here."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {history.map((request) => {
                  const meta = STATUS_META[request.status];
                  const Icon =
                    request.status === 'REJECTED'
                      ? XCircle
                      : request.status === 'COMPLETED'
                        ? CheckCircle2
                        : Clock3;

                  return (
                    <li key={request.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <Icon
                        className={
                          request.status === 'REJECTED'
                            ? 'mt-0.5 size-4 shrink-0 text-destructive'
                            : request.status === 'COMPLETED'
                              ? 'mt-0.5 size-4 shrink-0 text-success'
                              : 'mt-0.5 size-4 shrink-0 text-muted-foreground'
                        }
                      />

                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="truncate font-medium">{request.userName}</span>
                          <Badge variant={meta.tone}>{meta.label}</Badge>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Requested {formatDateTime(request.requestedAt)}
                          {request.decidedBy ? ` · decided by ${request.decidedBy}` : ''}
                          {request.completedAt
                            ? ` · completed ${formatDateTime(request.completedAt)}`
                            : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Approve / reject confirmation */}
      <ConfirmDialog
        open={Boolean(deciding)}
        onOpenChange={(open) => !open && setDeciding(null)}
        tone={deciding?.decision === 'APPROVED' ? 'caution' : 'danger'}
        title={
          deciding?.decision === 'APPROVED'
            ? `Approve reset for ${deciding.request.userName}?`
            : `Reject reset for ${deciding?.request.userName}?`
        }
        confirmLabel={deciding?.decision === 'APPROVED' ? 'Approve and send link' : 'Reject request'}
        loading={decide.submitting}
        description={
          deciding?.decision === 'APPROVED' ? (
            <>
              A single-use link will be emailed to{' '}
              <span className="font-semibold text-foreground">{deciding.request.userEmail}</span>,
              valid for {VIEW_RESET_TTL_MINUTES} minutes. Only they can use it — the link is not
              shown to you. Confirm out of band that this request is genuine before approving.
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">{deciding?.request.userName}</span>{' '}
              will be told the request was declined and no link will be issued.
            </>
          )
        }
        onConfirm={async () => {
          if (!deciding) return;
          await decide.run(
            { id: deciding.request.id, decision: deciding.decision },
            {
              successMessage:
                deciding.decision === 'APPROVED'
                  ? 'Approved. A single-use link has been emailed.'
                  : 'Request rejected.',
              onSuccess: async () => {
                setDeciding(null);
                await refresh();
              },
            },
          );
        }}
      />
    </div>
  );
}
