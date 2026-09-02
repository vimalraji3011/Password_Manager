import { clientIp, fail, notFound, ok, readBody, userAgent, withAuth } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { users } from '@/lib/auth';
import { OTP_TTL_MINUTES } from '@/lib/constants';
import { generateOtp, hashToken } from '@/lib/crypto';
import { sendMail, templates } from '@/lib/mailer';
import { resetRequests } from '@/lib/repository';
import { adminResetUserSchema, fieldErrors } from '@/lib/validation';

/**
 * POST /api/users/reset-password
 *
 * "Reset user password", admin-initiated. The admin does **not** choose the new
 * password — they trigger the same emailed one-time code the user would get from
 * the forgot-password flow, and the user sets their own.
 *
 * That is deliberate: an admin who could set another user's password could
 * impersonate them, and the audit log would show the user's actions, not the
 * admin's. This way the vault keeps a meaningful notion of "who did that".
 */
export const POST = withAuth<{ sent: true; email: string; expiresInMinutes: number }>(
  async ({ request, user: admin }) => {
    const parsed = adminResetUserSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      return fail('Select a user to reset.', 422, fieldErrors(parsed.error));
    }

    const target = await users.byId(parsed.data.userId);
    if (!target) return notFound('User');

    // Supersede any code already outstanding for this user.
    const pending = await resetRequests.filter(
      (item) =>
        item.userId === target.id && item.kind === 'LOGIN_PASSWORD' && item.status === 'PENDING',
    );
    for (const item of pending) {
      await resetRequests.update(item.id, { status: 'EXPIRED' });
    }

    const otp = generateOtp();
    const now = new Date();

    await resetRequests.insert({
      kind: 'LOGIN_PASSWORD',
      userId: target.id,
      userName: target.name,
      userEmail: target.email,
      status: 'PENDING',
      reason: `Initiated by ${admin.name}`,
      tokenHash: hashToken(otp),
      expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000).toISOString(),
      attempts: 0,
      requestedAt: now.toISOString(),
    });

    // Flagged so the UI can prompt for a change at next sign-in.
    await users.update(target.id, { mustChangePassword: true, updatedAt: now.toISOString() });

    const result = await sendMail(
      templates.adminResetUser(target.email, target.name, otp, OTP_TTL_MINUTES),
    );

    await recordAudit({
      action: 'USER_PASSWORD_RESET',
      actor: { id: admin.id, name: admin.name, email: admin.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      detail: `Reset code sent to ${target.email}${result.sent ? '' : ' (email delivery failed)'}`,
    });

    if (!result.sent) {
      return fail(
        'The reset was recorded but the email could not be sent. Check the SMTP settings.',
        502,
      );
    }

    return ok({ sent: true, email: target.email, expiresInMinutes: OTP_TTL_MINUTES });
  },
  { role: 'admin' },
);
