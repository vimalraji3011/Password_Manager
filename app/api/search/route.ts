import { ok, withAuth } from '@/lib/api';
import { searchEverything } from '@/lib/repository';
import type { OrganizationWithCount, SafeSource } from '@/types';

/** Shape returned to the command palette. */
interface SearchResponse {
  organizations: OrganizationWithCount[];
  sources: Array<SafeSource & { organizationName: string }>;
  totals: { organizations: number; sources: number };
}

/**
 * GET /api/search?q=...
 *
 * Powers the command palette. Matches case-insensitively and by substring
 * across organization names, source names, usernames and URLs.
 *
 * Available to viewers too — finding *that* a credential exists is read access,
 * which viewers have. Revealing its value is a separate, admin-only endpoint.
 */
export const GET = withAuth<SearchResponse>(async ({ request }) => {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  // An empty query would match everything; return nothing instead.
  if (query.length === 0) {
    return ok({ organizations: [], sources: [], totals: { organizations: 0, sources: 0 } });
  }

  const results = await searchEverything(query);

  // Cap the payload — the palette shows a shortlist, not a full result set.
  return ok({
    organizations: results.organizations.slice(0, 6),
    sources: results.sources.slice(0, 10),
    totals: {
      organizations: results.organizations.length,
      sources: results.sources.length,
    },
  });
});
