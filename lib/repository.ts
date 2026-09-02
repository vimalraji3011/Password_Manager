import 'server-only';
import { Collection, FILES } from '@/lib/json-storage';
import { contains } from '@/lib/utils';
import type {
  Organization,
  OrganizationWithCount,
  ResetRequest,
  SafeSource,
  Source,
} from '@/types';

/**
 * Data-access layer for the vault.
 *
 * Route handlers talk to these functions rather than to `Collection` directly,
 * which keeps duplicate-name checks, cascade deletes and the
 * "never serialise ciphertext" rule in exactly one place.
 */

export const organizations = new Collection<Organization>(FILES.organizations);
export const sources = new Collection<Source>(FILES.sources);
export const resetRequests = new Collection<ResetRequest>(FILES.resetRequests);

/* ------------------------------------------------------------------ *
 * Serialisation guards
 * ------------------------------------------------------------------ */

/**
 * Strip the AES envelope before a source crosses the network. Ciphertext only
 * ever leaves the server through the deliberate reveal endpoint.
 */
export function toSafeSource(source: Source): SafeSource {
  const { password, ...rest } = source;
  return { ...rest, hasPassword: Boolean(password?.data) };
}

/* ------------------------------------------------------------------ *
 * Organizations
 * ------------------------------------------------------------------ */

export type SortKey = 'name' | 'updatedAt' | 'createdAt' | 'sourceCount';
export type SortDirection = 'asc' | 'desc';

export async function listOrganizations(options?: {
  search?: string;
  sort?: SortKey;
  direction?: SortDirection;
}): Promise<OrganizationWithCount[]> {
  const [orgs, allSources] = await Promise.all([organizations.all(), sources.all()]);

  const counts = new Map<number, number>();
  for (const source of allSources) {
    counts.set(source.organizationId, (counts.get(source.organizationId) ?? 0) + 1);
  }

  const search = options?.search?.trim() ?? '';
  const enriched: OrganizationWithCount[] = orgs
    .map((org) => ({ ...org, sourceCount: counts.get(org.id) ?? 0 }))
    .filter((org) => contains(org.name, search) || contains(org.description, search));

  const sort = options?.sort ?? 'name';
  const direction = options?.direction ?? 'asc';
  const factor = direction === 'asc' ? 1 : -1;

  enriched.sort((a, b) => {
    if (sort === 'sourceCount') return (a.sourceCount - b.sourceCount) * factor;
    if (sort === 'name') return a.name.localeCompare(b.name) * factor;
    return a[sort].localeCompare(b[sort]) * factor;
  });

  return enriched;
}

/** Case-insensitive duplicate check, optionally ignoring one record (edit). */
export async function organizationNameTaken(name: string, ignoreId?: number): Promise<boolean> {
  const target = name.trim().toLowerCase();
  const all = await organizations.all();
  return all.some((org) => org.id !== ignoreId && org.name.trim().toLowerCase() === target);
}

/**
 * Delete an organization and every credential inside it. Returns the number of
 * sources removed so the caller can put it in the audit entry.
 */
export async function deleteOrganizationCascade(id: number): Promise<number | null> {
  const org = await organizations.byId(id);
  if (!org) return null;
  const removed = await sources.removeWhere((source) => source.organizationId === id);
  await organizations.remove(id);
  return removed;
}

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

export async function listSources(options?: {
  organizationId?: number;
  search?: string;
  sort?: 'source' | 'username' | 'updatedAt';
  direction?: SortDirection;
}): Promise<SafeSource[]> {
  const all = await sources.all();
  const search = options?.search?.trim() ?? '';

  const filtered = all
    .filter((s) => !options?.organizationId || s.organizationId === options.organizationId)
    .filter(
      (s) =>
        contains(s.source, search) ||
        contains(s.username, search) ||
        contains(s.url, search) ||
        contains(s.notes, search),
    );

  const sort = options?.sort ?? 'source';
  const factor = (options?.direction ?? 'asc') === 'asc' ? 1 : -1;
  filtered.sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * factor);

  return filtered.map(toSafeSource);
}

/**
 * Global search across organizations and sources, used by the command palette
 * and the dashboard search box.
 */
export async function searchEverything(query: string): Promise<{
  organizations: OrganizationWithCount[];
  sources: Array<SafeSource & { organizationName: string }>;
}> {
  const trimmed = query.trim();
  const [orgs, allSources] = await Promise.all([listOrganizations({ search: trimmed }), sources.all()]);
  const orgNames = new Map((await organizations.all()).map((o) => [o.id, o.name]));

  const matchedSources = allSources
    .filter(
      (s) =>
        contains(s.source, trimmed) ||
        contains(s.username, trimmed) ||
        contains(s.url, trimmed) ||
        contains(orgNames.get(s.organizationId), trimmed),
    )
    .map((s) => ({
      ...toSafeSource(s),
      organizationName: orgNames.get(s.organizationId) ?? 'Unknown',
    }));

  return { organizations: orgs, sources: matchedSources };
}

/** A source name must be unique inside its organization, not globally. */
export async function sourceNameTaken(
  organizationId: number,
  name: string,
  ignoreId?: number,
): Promise<boolean> {
  const target = name.trim().toLowerCase();
  const all = await sources.all();
  return all.some(
    (s) =>
      s.id !== ignoreId &&
      s.organizationId === organizationId &&
      s.source.trim().toLowerCase() === target,
  );
}

/** Keep the parent organization's `updatedAt`/`updatedBy` in step with its children. */
export async function touchOrganization(id: number, updatedBy: string): Promise<void> {
  await organizations.update(id, { updatedAt: new Date().toISOString(), updatedBy });
}

/* ------------------------------------------------------------------ *
 * Dashboard aggregates
 * ------------------------------------------------------------------ */

export interface DashboardStats {
  organizationCount: number;
  sourceCount: number;
  revealsLast7Days: number;
  pendingRequests: number;
  recentlyUpdated: Array<SafeSource & { organizationName: string }>;
  topOrganizations: OrganizationWithCount[];
}

export async function getDashboardStats(): Promise<Omit<DashboardStats, 'revealsLast7Days' | 'pendingRequests'>> {
  const [orgs, allSources] = await Promise.all([listOrganizations(), sources.all()]);
  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));

  const recentlyUpdated = [...allSources]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)
    .map((s) => ({
      ...toSafeSource(s),
      organizationName: orgNames.get(s.organizationId) ?? 'Unknown',
    }));

  const topOrganizations = [...orgs].sort((a, b) => b.sourceCount - a.sourceCount).slice(0, 5);

  return {
    organizationCount: orgs.length,
    sourceCount: allSources.length,
    recentlyUpdated,
    topOrganizations,
  };
}
