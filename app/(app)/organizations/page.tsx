import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/shared/page-header';
import { OrganizationsView } from '@/components/organizations/organizations-view';
import { Skeleton } from '@/components/ui/skeleton';
import { getCurrentUser } from '@/lib/auth';
import { listOrganizations } from '@/lib/repository';

export const metadata: Metadata = { title: 'Organizations' };

/**
 * Organizations index.
 *
 * Reads the datastore on the server and hands the result to a client component
 * that owns search, sort and the CRUD dialogs. The list is small enough that
 * shipping it whole beats paginating over the network.
 */
export default async function OrganizationsPage() {
  const [user, organizations] = await Promise.all([getCurrentUser(), listOrganizations()]);

  return (
    <div>
      <PageHeader
        title="Organizations"
        description={
          user?.role === 'admin'
            ? 'Group credentials by company, client or environment. Deleting an organization removes its credentials too.'
            : 'Browse the organizations in the vault. Credential values stay hidden with a Viewer account.'
        }
      />

      {/*
        OrganizationsView reads `?new=1` via useSearchParams, so it needs a
        Suspense boundary to keep the rest of the page prerenderable.
      */}
      <Suspense fallback={<OrganizationsSkeleton />}>
        <OrganizationsView
          initialOrganizations={organizations}
          role={user?.role ?? 'viewer'}
        />
      </Suspense>
    </div>
  );
}

function OrganizationsSkeleton() {
  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <Skeleton className="h-10 w-full sm:max-w-sm" />
        <Skeleton className="h-10 w-full sm:w-48" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Skeleton key={index} className="h-56 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
