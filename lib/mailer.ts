import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Transactional email over Brevo SMTP.
 *
 * Two hard rules, enforced by construction:
 *  1. **No credential ever appears in an email.** Templates take a source name
 *     and an actor, never a password. OTPs are the one exception and they are
 *     single-use, short-lived and hashed at rest.
 *  2. **Email failures never fail the user's action.** `sendMail` resolves with
 *     `{ sent: false }` instead of throwing, because a credential update must
 *     still succeed when SMTP is down.
 *
 * When `EMAIL_DEV_MODE=true` (or SMTP is unconfigured) messages are printed to
 * the server console, so the whole app is usable before Brevo is provisioned.
 */

let transporter: Transporter | null = null;

function isDevMode(): boolean {
  if (process.env.EMAIL_DEV_MODE === 'true') return true;
  return !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS;
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 587 uses STARTTLS, which nodemailer negotiates
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
  return transporter;
}

function fromAddress(): string {
  const name = process.env.FROM_NAME ?? 'Office Password Manager';
  const address = process.env.FROM_EMAIL ?? 'no-reply@localhost';
  return `"${name}" <${address}>`;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export interface MailInput {
  to: string;
  subject: string;
  heading: string;
  /** Body paragraphs. Plain text — escaped before it reaches the HTML template. */
  lines: string[];
  cta?: { label: string; url: string };
  /** Large monospace block used for OTP codes. */
  code?: string;
  footnote?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Dark-on-light, table-based layout — the only thing every mail client agrees on. */
function renderHtml(input: MailInput): string {
  const paragraphs = input.lines
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(line)}</p>`,
    )
    .join('');

  const code = input.code
    ? `<div style="margin:22px 0;padding:18px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;text-align:center;">
         <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;letter-spacing:10px;font-weight:700;color:#0f172a;">${escapeHtml(input.code)}</div>
       </div>`
    : '';

  const cta = input.cta
    ? `<div style="margin:26px 0 8px;">
         <a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 26px;border-radius:10px;background:#4f46e5;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(input.cta.label)}</a>
       </div>`
    : '';

  const footnote = input.footnote
    ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(input.footnote)}</p>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;">
      <tr>
        <td style="padding:0 0 20px;">
          <span style="display:inline-block;padding:8px 14px;border-radius:10px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.5px;">OFFICE PASSWORD MANAGER</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:#0f172a;">${escapeHtml(input.heading)}</h1>
          ${paragraphs}
          ${code}
          ${cta}
          ${footnote}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 4px;font-size:12px;line-height:1.6;color:#94a3b8;">
          This is an automated notification from your organization's internal password vault.
          Credentials are never included in email.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(input: MailInput): string {
  const parts = [input.heading, '', ...input.lines];
  if (input.code) parts.push('', `Code: ${input.code}`);
  if (input.cta) parts.push('', `${input.cta.label}: ${input.cta.url}`);
  if (input.footnote) parts.push('', input.footnote);
  parts.push('', 'Credentials are never included in email.');
  return parts.join('\n');
}

export async function sendMail(input: MailInput): Promise<{ sent: boolean; error?: string }> {
  const message = {
    from: fromAddress(),
    to: input.to,
    subject: input.subject,
    text: renderText(input),
    html: renderHtml(input),
  };

  if (isDevMode()) {
    console.info(
      [
        '',
        '──────────── EMAIL (dev mode, not sent) ────────────',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return { sent: true };
  }

  try {
    await getTransporter().sendMail(message);
    return { sent: true };
  } catch (error) {
    console.error('[mailer] send failed', error);
    return { sent: false, error: error instanceof Error ? error.message : 'Unknown SMTP error' };
  }
}

/* ------------------------------------------------------------------ *
 * Templates — the only place email copy lives.
 * ------------------------------------------------------------------ */

export const templates = {
  loginOtp: (to: string, name: string, otp: string, minutes: number): MailInput => ({
    to,
    subject: 'Your password reset code',
    heading: `Hi ${name}, here is your reset code`,
    lines: [
      'Use the code below to reset your Office Password Manager login password.',
      `The code expires in ${minutes} minutes and can only be used once.`,
    ],
    code: otp,
    footnote: 'If you did not request this, you can safely ignore this email and your password stays unchanged.',
  }),

  adminResetUser: (to: string, name: string, otp: string, minutes: number): MailInput => ({
    to,
    subject: 'A System Admin started a password reset for your account',
    heading: `Hi ${name}, your login password reset is ready`,
    lines: [
      'A System Admin has initiated a password reset for your Office Password Manager account.',
      `Enter the code below on the reset page. It expires in ${minutes} minutes.`,
    ],
    code: otp,
    cta: { label: 'Reset my password', url: `${appUrl()}/reset-password?email=${encodeURIComponent(to)}` },
    footnote: 'Contact your System Admin if you were not expecting this.',
  }),

  viewResetRequestToAdmin: (
    to: string,
    requester: string,
    requesterEmail: string,
    reason: string | undefined,
    requestId: number,
  ): MailInput => ({
    to,
    subject: `Approval needed: reveal-password reset for ${requester}`,
    heading: 'A reveal-password reset needs your approval',
    lines: [
      `${requester} (${requesterEmail}) can no longer confirm their identity to reveal stored credentials and has requested a reset.`,
      reason ? `Reason given: ${reason}` : 'No reason was provided.',
      'Approving this sends the requester a single-use verification link. Nothing is revealed until they use it.',
    ],
    cta: { label: 'Review request', url: `${appUrl()}/reset-view-password#request-${requestId}` },
    footnote: 'Only a System Admin can approve this request.',
  }),

  viewResetApproved: (to: string, name: string, token: string, minutes: number): MailInput => ({
    to,
    subject: 'Your reveal-password reset was approved',
    heading: `Hi ${name}, your request was approved`,
    lines: [
      'A System Admin approved your request to reset the password you use to reveal stored credentials.',
      `Use the link below within ${minutes} minutes to set a new one. The link works only once.`,
    ],
    cta: {
      label: 'Set a new password',
      url: `${appUrl()}/reset-view-password/verify?token=${encodeURIComponent(token)}`,
    },
    footnote: 'If you did not make this request, tell your System Admin immediately.',
  }),

  viewResetRejected: (to: string, name: string, admin: string): MailInput => ({
    to,
    subject: 'Your reveal-password reset was declined',
    heading: `Hi ${name}, your request was declined`,
    lines: [
      `${admin} declined your request to reset the reveal password.`,
      'Speak with your System Admin if you still need access.',
    ],
  }),

  sourceUpdated: (
    to: string,
    actor: string,
    organization: string,
    source: string,
  ): MailInput => ({
    to,
    subject: `${source} credential updated (${organization})`,
    heading: 'A stored credential was updated',
    lines: [
      `${source} credential updated by ${actor}.`,
      `Organization: ${organization}`,
      'Open the vault if you need to review the change.',
    ],
    cta: { label: 'Open vault', url: `${appUrl()}/organizations` },
    footnote: 'The credential itself is deliberately not included in this notification.',
  }),

  sourceCreated: (to: string, actor: string, organization: string, source: string): MailInput => ({
    to,
    subject: `${source} added to ${organization}`,
    heading: 'A new credential was added',
    lines: [`${source} was added to ${organization} by ${actor}.`],
    cta: { label: 'Open vault', url: `${appUrl()}/organizations` },
  }),

  sourceDeleted: (to: string, actor: string, organization: string, source: string): MailInput => ({
    to,
    subject: `${source} credential deleted (${organization})`,
    heading: 'A stored credential was deleted',
    lines: [
      `${source} credential deleted by ${actor}.`,
      `Organization: ${organization}`,
      'This action cannot be undone. Raise it with your System Admin if it was unexpected.',
    ],
  }),

  passwordRevealed: (
    to: string,
    actor: string,
    organization: string,
    source: string,
    ip: string,
  ): MailInput => ({
    to,
    subject: `${source} password was revealed`,
    heading: 'A stored password was revealed',
    lines: [
      `${actor} revealed the ${source} password for ${organization}.`,
      `Source IP: ${ip}`,
    ],
    cta: { label: 'View audit log', url: `${appUrl()}/audit` },
  }),

  organizationDeleted: (to: string, actor: string, organization: string, count: number): MailInput => ({
    to,
    subject: `Organization deleted: ${organization}`,
    heading: 'An organization was deleted',
    lines: [
      `${organization} was deleted by ${actor}.`,
      `${count} credential${count === 1 ? '' : 's'} stored inside it were removed as well.`,
    ],
  }),
};
