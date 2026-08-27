import { clientIp, fail, ok, readBody, userAgent, withAuth } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { resetRequests } from '@/lib/repository';
import { fieldErrors, viewResetRequestSchema } from '@/lib/validation';
import type { ResetRequest } from '@/types';

/**
 * Reveal-password reset requests.
 *
 * Background: the password that unlocks a reveal *is* the user's login password.
 * So someone who has forgotten it cannot simply be emailed a code — an attacker
 * sitting on a hijacked session could trigger that themselves. Instead the
 * request goes to a System Admin, who approves it out of band, and only then is
 * a single-use link issued.
 */

/**
 * GET /api/reset-requests
 *
 * Admins see every request (they are the approvers). A viewer sees only their
 * own, so the endpoint doubles as "what happened to my request?".
 */
export const GET = withAuth<ResetRequest[]>(async ({ user }) => {
  const all = await resetRequests.filter((item) => item.kind === 'VIEW_PASSWORD');
  const visible = user.role === 'admin' ? all : all.filter((item) => item.userId === user.id);

  // Pending first, then newest — that is the order an approver wants.
  visible.sort((a, b) => {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
    if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
    return b.requestedAt.localeCompare(a.requestedAt);
  });

  // `tokenHash` must never cross the network, even to an admin: it is the only
  // thing standing between a leaked response and a password reset.
  return ok(visible.map(({ tokenHash: _tokenHash, ...rest }) => rest));
});

/**
 * POST /api/reset-requests
 *
 * Raise a reveal-password reset request for yourself. No token is minted here —
 * that only happens on approval.
 */
export const POST = withAuth<ResetRequest>(async ({ request, user }) => {
  const parsed = viewResetRequestSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
  }

  // One open request at a time, so an admin's queue cannot be spammed.
  const existing = await resetRequests.find(
    (item) =>
      item.userId === user.id && item.kind === 'VIEW_PASSWORD' && item.status === 'PENDING',
  );

  if (existing) {
    return fail(
      'You already have a request awaiting approval. A System Admin will action it shortly.',
      409,
    );
  }

  const created = await resetRequests.insert({
    kind: 'VIEW_PASSWORD',
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    status: 'PENDING',
    reason: parsed.data.reason || '',
    tokenHash: null,
    expiresAt: null,
    attempts: 0,
    requestedAt: new Date().toISOString(),
  });

  await recordAudit({
    action: 'RESET_REQUESTED',
    actor: { id: user.id, name: user.name, email: user.email },
    ip: clientIp(request),
    userAgent: userAgent(request),
    detail: `Reveal-password reset requested${parsed.data.reason ? `: ${parsed.data.reason}` : ''}`,
  });

  void notify.viewResetRequested(user, parsed.data.reason, created.id);

  const { tokenHash: _tokenHash, ...safe } = created;
  return ok(safe, { status: 201 });
});
