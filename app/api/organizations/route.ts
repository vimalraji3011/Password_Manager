import { clientIp, fail, ok, readBody, userAgent, withAuth } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import {
  listOrganizations,
  organizationNameTaken,
  organizations,
  type SortDirection,
  type SortKey,
} from '@/lib/repository';
import { fieldErrors, organizationSchema } from '@/lib/validation';
import type { Organization, OrganizationWithCount } from '@/types';

/**
 * GET /api/organizations?search=&sort=&direction=
 *
 * Listing is open to both roles — a viewer is allowed to know which
 * organizations exist and how many credentials each holds.
 */
export const GET = withAuth<OrganizationWithCount[]>(async ({ request }) => {
  const params = new URL(request.url).searchParams;

  const sortParam = params.get('sort');
  const allowedSorts: SortKey[] = ['name', 'updatedAt', 'createdAt', 'sourceCount'];
  const sort = allowedSorts.includes(sortParam as SortKey) ? (sortParam as SortKey) : 'name';
  const direction: SortDirection = params.get('direction') === 'desc' ? 'desc' : 'asc';

  return ok(
    await listOrganizations({
      search: params.get('search') ?? '',
      sort,
      direction,
    }),
  );
});

/**
 * POST /api/organizations
 *
 * Admin only. Names must be unique case-insensitively, so "Aafiya" and "aafiya"
 * cannot both exist and confuse whoever is looking for a credential later.
 */
export const POST = withAuth<Organization>(
  async ({ request, user }) => {
    const parsed = organizationSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      return fail('Please correct the highlighted fields.', 422, fieldErrors(parsed.error));
    }

    const { name, description } = parsed.data;

    if (await organizationNameTaken(name)) {
      return fail('An organization with that name already exists.', 409, {
        name: 'This name is already in use.',
      });
    }

    const now = new Date().toISOString();
    const created = await organizations.insert({
      name,
      description: description || '',
      createdAt: now,
      updatedAt: now,
      updatedBy: user.name,
    });

    await recordAudit({
      action: 'ORGANIZATION_CREATED',
      actor: { id: user.id, name: user.name, email: user.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      organizationId: created.id,
      organization: created.name,
    });

    return ok(created, { status: 201 });
  },
  { role: 'admin' },
);
