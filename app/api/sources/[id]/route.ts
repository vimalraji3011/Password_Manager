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
import { encrypt } from '@/lib/crypto';
import { notify } from '@/lib/notify';
import {
  organizations,
  sourceNameTaken,
  sources,
  toSafeSource,
  touchOrganization,
} from '@/lib/repository';
import { fieldErrors, sourceUpdateSchema } from '@/lib/validation';
import type { SafeSource } from '@/types';

type Params = { id: string };

/** GET /api/sources/[id] — metadata only, never the credential value. */
export const GET = withAuthParams<SafeSource, Params>(async ({ params }) => {
  const id = parseId(params.id);
  if (!id) return fail('Invalid source id.', 400);

  const source = await sources.byId(id);
  if (!source) return notFound('Source');

  return ok(toSafeSource(source));
});

/**
 * PATCH /api/sources/[id]
 *
 * Admin only. An omitted or empty `password` means "leave the stored credential
 * alone" — that is what lets someone fix a typo in a username without having to
 * know or re-enter the password.
 */
export const PATCH = withAuthParams<SafeSource, Params>(
  async ({ params, request, user }) => {
    const id = parseId(params.id);
    if (!id) return fail('Invalid source id.', 400);

    const existing = await sources.byId(id);
    if (!existing) return notFound('Source');

    const parsed = sourceUpdateSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
    }

    const body = parsed.data;
    const organizationId = body.organizationId ?? existing.organizationId;

    const organization = await organizations.byId(organizationId);
    if (!organization) {
      return fail('That organization no longer exists.', 404, {
        organizationId: 'Select an existing organization.',
      });
    }

    const nextName = body.source ?? existing.source;
    if (await sourceNameTaken(organizationId, nextName, id)) {
      return fail(`${organization.name} already has a source named "${nextName}".`, 409, {
        source: 'This source name is already used in this organization.',
      });
    }

    const passwordChanged = Boolean(body.password && body.password.length > 0);

    const updated = await sources.update(id, {
      organizationId,
      source: nextName,
      username: body.username ?? existing.username,
      url: body.url ?? existing.url,
      notes: body.notes ?? existing.notes,
      ...(passwordChanged ? { password: encrypt(body.password!) } : {}),
      updatedAt: new Date().toISOString(),
      updatedBy: user.name,
    });

    if (!updated) return notFound('Source');

    await touchOrganization(organizationId, user.name);
    // A moved source leaves its old parent looking stale otherwise.
    if (organizationId !== existing.organizationId) {
      await touchOrganization(existing.organizationId, user.name);
    }

    // Two distinct actions: a password rotation is more sensitive than a
    // metadata edit, and the audit log should be able to tell them apart.
    await recordAudit({
      action: passwordChanged ? 'PASSWORD_UPDATED' : 'SOURCE_UPDATED',
      actor: { id: user.id, name: user.name, email: user.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      organizationId,
      organization: organization.name,
      sourceId: id,
      source: updated.source,
      detail: passwordChanged ? 'Credential value rotated' : 'Details updated',
    });

    void notify.sourceUpdated(user, organization.name, updated.source);

    return ok(toSafeSource(updated));
  },
  { role: 'admin' },
);

/** DELETE /api/sources/[id] — admin only, irreversible, audited and emailed. */
export const DELETE = withAuthParams<{ deleted: true }, Params>(
  async ({ params, request, user }) => {
    const id = parseId(params.id);
    if (!id) return fail('Invalid source id.', 400);

    const existing = await sources.byId(id);
    if (!existing) return notFound('Source');

    const organization = await organizations.byId(existing.organizationId);
    const removed = await sources.remove(id);
    if (!removed) return notFound('Source');

    await touchOrganization(existing.organizationId, user.name);

    await recordAudit({
      action: 'SOURCE_DELETED',
      actor: { id: user.id, name: user.name, email: user.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      organizationId: existing.organizationId,
      organization: organization?.name ?? null,
      sourceId: id,
      source: existing.source,
      detail: `Username: ${existing.username}`,
    });

    void notify.sourceDeleted(user, organization?.name ?? 'Unknown', existing.source);

    return ok({ deleted: true });
  },
  { role: 'admin' },
);
