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
import { notify } from '@/lib/notify';
import {
  deleteOrganizationCascade,
  listSources,
  organizationNameTaken,
  organizations,
} from '@/lib/repository';
import { fieldErrors, organizationSchema } from '@/lib/validation';
import type { Organization, OrganizationWithCount, SafeSource } from '@/types';

type Params = { id: string };

/**
 * GET /api/organizations/[id]
 *
 * Returns the organization together with its credential sources. Passwords are
 * stripped by `toSafeSource` inside the repository, so ciphertext never appears
 * in this payload — revealing a value is a separate, deliberate request.
 */
export const GET = withAuthParams<
  { organization: OrganizationWithCount; sources: SafeSource[] },
  Params
>(async ({ params, request }) => {
  const id = parseId(params.id);
  if (!id) return fail('Invalid organization id.', 400);

  const organization = await organizations.byId(id);
  if (!organization) return notFound('Organization');

  const search = new URL(request.url).searchParams.get('search') ?? '';
  const sources = await listSources({ organizationId: id, search });

  return ok({
    organization: { ...organization, sourceCount: sources.length },
    sources,
  });
});

/** PATCH /api/organizations/[id] — admin only rename / re-describe. */
export const PATCH = withAuthParams<Organization, Params>(
  async ({ params, request, user }) => {
    const id = parseId(params.id);
    if (!id) return fail('Invalid organization id.', 400);

    const existing = await organizations.byId(id);
    if (!existing) return notFound('Organization');

    const parsed = organizationSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
    }

    const { name, description } = parsed.data;

    // Ignore this record so re-saving without a rename is not a conflict.
    if (await organizationNameTaken(name, id)) {
      return fail('An organization with that name already exists.', 409, {
        name: 'This name is already in use.',
      });
    }

    const updated = await organizations.update(id, {
      name,
      description: description || '',
      updatedAt: new Date().toISOString(),
      updatedBy: user.name,
    });

    if (!updated) return notFound('Organization');

    await recordAudit({
      action: 'ORGANIZATION_UPDATED',
      actor: { id: user.id, name: user.name, email: user.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      organizationId: id,
      organization: updated.name,
      detail: existing.name !== updated.name ? `Renamed from "${existing.name}"` : 'Details updated',
    });

    return ok(updated);
  },
  { role: 'admin' },
);

/**
 * DELETE /api/organizations/[id]
 *
 * Admin only, and cascading: deleting an organization removes every credential
 * inside it. That is destructive and irreversible, so the count of removed
 * sources goes into the audit entry and into the notification email.
 */
export const DELETE = withAuthParams<{ deleted: true; removedSources: number }, Params>(
  async ({ params, request, user }) => {
    const id = parseId(params.id);
    if (!id) return fail('Invalid organization id.', 400);

    const existing = await organizations.byId(id);
    if (!existing) return notFound('Organization');

    const removedSources = await deleteOrganizationCascade(id);
    if (removedSources === null) return notFound('Organization');

    await recordAudit({
      action: 'ORGANIZATION_DELETED',
      actor: { id: user.id, name: user.name, email: user.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      organizationId: id,
      organization: existing.name,
      detail: `${removedSources} credential source(s) removed with it`,
    });

    // Fire-and-forget: a mail failure must not fail the delete.
    void notify.organizationDeleted(user, existing.name, removedSources);

    return ok({ deleted: true, removedSources });
  },
  { role: 'admin' },
);
