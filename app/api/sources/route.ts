import { clientIp, fail, ok, readBody, userAgent, withAuth } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { encrypt } from '@/lib/crypto';
import { notify } from '@/lib/notify';
import {
  listSources,
  organizations,
  sourceNameTaken,
  sources,
  toSafeSource,
  touchOrganization,
} from '@/lib/repository';
import { fieldErrors, sourceSchema } from '@/lib/validation';
import type { SafeSource } from '@/types';

/**
 * GET /api/sources?organizationId=&search=
 *
 * Returns credentials with the ciphertext removed. Both roles may list — a
 * viewer needs to know a credential exists; only an admin can reveal its value.
 */
export const GET = withAuth<SafeSource[]>(async ({ request }) => {
  const params = new URL(request.url).searchParams;
  const organizationId = Number(params.get('organizationId'));

  return ok(
    await listSources({
      organizationId: Number.isInteger(organizationId) && organizationId > 0 ? organizationId : undefined,
      search: params.get('search') ?? '',
    }),
  );
});

/**
 * POST /api/sources
 *
 * Admin only. The submitted password is encrypted with AES-256-GCM before it
 * touches disk, and the plaintext is never logged, audited or echoed back.
 */
export const POST = withAuth<SafeSource>(
  async ({ request, user }) => {
    const parsed = sourceSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
    }

    const { organizationId, source, username, password, url, notes } = parsed.data;

    const organization = await organizations.byId(organizationId);
    if (!organization) {
      return fail('That organization no longer exists.', 404, {
        organizationId: 'Select an existing organization.',
      });
    }

    // Uniqueness is per organization: two companies may both have an "AWS".
    if (await sourceNameTaken(organizationId, source)) {
      return fail(`${organization.name} already has a source named "${source}".`, 409, {
        source: 'This source name is already used in this organization.',
      });
    }

    const now = new Date().toISOString();
    const created = await sources.insert({
      organizationId,
      source,
      username,
      password: encrypt(password),
      url: url ?? '',
      notes: notes ?? '',
      createdAt: now,
      updatedAt: now,
      updatedBy: user.name,
    });

    await touchOrganization(organizationId, user.name);

    await recordAudit({
      action: 'SOURCE_CREATED',
      actor: { id: user.id, name: user.name, email: user.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      organizationId,
      organization: organization.name,
      sourceId: created.id,
      source: created.source,
      detail: `Username: ${username}`,
    });

    void notify.sourceCreated(user, organization.name, created.source);

    return ok(toSafeSource(created), { status: 201 });
  },
  { role: 'admin' },
);
