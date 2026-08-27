import {
  clientIp,
  fail,
  notFound,
  ok,
  parseId,
  readBody,
  userAgent,
  withAuthParams,
} from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { users } from '@/lib/auth';
import { VIEW_RESET_TTL_MINUTES } from '@/lib/constants';
import { generateToken, hashToken } from '@/lib/crypto';
import { sendMail, templates } from '@/lib/mailer';
import { resetRequests } from '@/lib/repository';
import { decideRequestSchema, fieldErrors } from '@/lib/validation';
import type { ResetRequest } from '@/types';

type Params = { id: string };

/**
 * POST /api/reset-requests/[id]/decide
 *
 * Admin approves or rejects a reveal-password reset.
 *
 * On approval a single-use token is minted, hashed into the datastore, and the
 * plaintext is sent to the requester by email only. The admin never sees it —
 * which is what stops an approval from doubling as a way to take over someone
 * else's account.
 */
export const POST = withAuthParams<ResetRequest, Params>(
  async ({ params, request, user: admin }) => {
    const id = parseId(params.id);
    if (!id) return fail('Invalid request id.', 400);

    const parsed = decideRequestSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      return fail('Choose whether to approve or reject.', 422, fieldErrors(parsed.error));
    }

    const resetRequest = await resetRequests.byId(id);
    if (!resetRequest || resetRequest.kind !== 'VIEW_PASSWORD') return notFound('Request');

    if (resetRequest.status !== 'PENDING') {
      return fail(`This request has already been ${resetRequest.status.toLowerCase()}.`, 409);
    }

    const requester = await users.byId(resetRequest.userId);
    if (!requester) return fail('The requesting user no longer exists.', 410);

    const now = new Date();
    const approved = parsed.data.decision === 'APPROVED';

    if (!approved) {
      const updated = await resetRequests.update(id, {
        status: 'REJECTED',
        decidedAt: now.toISOString(),
        decidedBy: admin.name,
        tokenHash: null,
      });

      await recordAudit({
        action: 'RESET_REJECTED',
        actor: { id: admin.id, name: admin.name, email: admin.email },
        ip: clientIp(request),
        userAgent: userAgent(request),
        detail: `Reveal-password reset for ${requester.email} rejected`,
      });

      void sendMail(templates.viewResetRejected(requester.email, requester.name, admin.name));

      const { tokenHash: _tokenHash, ...safe } = updated!;
      return ok(safe);
    }

    const token = generateToken(32);

    const updated = await resetRequests.update(id, {
      status: 'APPROVED',
      decidedAt: now.toISOString(),
      decidedBy: admin.name,
      // Only the hash is persisted; the plaintext lives in the email alone.
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + VIEW_RESET_TTL_MINUTES * 60_000).toISOString(),
      attempts: 0,
    });

    await recordAudit({
      action: 'RESET_APPROVED',
      actor: { id: admin.id, name: admin.name, email: admin.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      detail: `Reveal-password reset for ${requester.email} approved; link valid ${VIEW_RESET_TTL_MINUTES} minutes`,
    });

    const mail = await sendMail(
      templates.viewResetApproved(requester.email, requester.name, token, VIEW_RESET_TTL_MINUTES),
    );

    if (!mail.sent) {
      return fail(
        'Approved, but the email could not be delivered. Check the SMTP settings and re-approve.',
        502,
      );
    }

    const { tokenHash: _tokenHash, ...safe } = updated!;
    return ok(safe);
  },
  { role: 'admin' },
);
