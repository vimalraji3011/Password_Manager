import 'server-only';
import { users } from '@/lib/auth';
import { sendMail, templates } from '@/lib/mailer';
import type { User } from '@/types';

/**
 * Event notifications.
 *
 * Sits between the route handlers and the mailer so a handler can say
 * "a source was deleted" without knowing who should hear about it. Every
 * function is fire-and-forget: notification is never allowed to fail the
 * underlying operation.
 */

/** Everyone who supervises the vault. Currently every admin account. */
async function admins(): Promise<User[]> {
  return users.filter((user) => user.role === 'admin');
}

/**
 * Notify all admins, skipping the person who performed the action — telling
 * someone about their own click is noise, not oversight.
 */
async function notifyAdmins(
  actor: Pick<User, 'id' | 'name'>,
  build: (adminEmail: string) => Parameters<typeof sendMail>[0],
): Promise<void> {
  const recipients = (await admins()).filter((admin) => admin.id !== actor.id);
  await Promise.allSettled(recipients.map((admin) => sendMail(build(admin.email))));
}

export const notify = {
  sourceCreated: (actor: User, organization: string, source: string) =>
    notifyAdmins(actor, (to) => templates.sourceCreated(to, actor.name, organization, source)),

  sourceUpdated: (actor: User, organization: string, source: string) =>
    notifyAdmins(actor, (to) => templates.sourceUpdated(to, actor.name, organization, source)),

  sourceDeleted: (actor: User, organization: string, source: string) =>
    notifyAdmins(actor, (to) => templates.sourceDeleted(to, actor.name, organization, source)),

  organizationDeleted: (actor: User, organization: string, removedSources: number) =>
    notifyAdmins(actor, (to) =>
      templates.organizationDeleted(to, actor.name, organization, removedSources),
    ),

  passwordRevealed: (actor: User, organization: string, source: string, ip: string) =>
    notifyAdmins(actor, (to) =>
      templates.passwordRevealed(to, actor.name, organization, source, ip),
    ),

  viewResetRequested: (
    requester: User,
    reason: string | undefined,
    requestId: number,
  ) =>
    notifyAdmins({ id: -1, name: requester.name }, (to) =>
      templates.viewResetRequestToAdmin(to, requester.name, requester.email, reason, requestId),
    ),
};
