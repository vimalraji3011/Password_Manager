import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Building2, Clock3, KeyRound, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { SourcesView } from '@/components/sources/sources-view';
import { getCurrentUser } from '@/lib/auth';
import { listSources, organizations } from '@/lib/repository';
import { formatDateTime } from '@/lib/utils';

/** Title reflects the organization, so browser tabs and history stay readable. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const organization = await organizations.byId(Number(id));
  return { title: organization?.name ?? 'Organization' };
}

/**
 * Organization detail: the credential list for one organization.
 *
 * Sources are loaded here with their ciphertext already stripped by the
 * repository, so the HTML delivered to the browser contains no encrypted
 * material at all — revealing a password is a separate, explicit request.
 */
export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organizationId = Number(id);
  if (!Number.isInteger(organizationId) || organizationId <= 0) notFound();

  const [user, organization, sources, allOrganizations] = await Promise.all([
    getCurrentUser(),
    organizations.byId(organizationId),
    listSources({ organizationId }),
    organizations.all(),
  ]);

  if (!organization) notFound();

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground">
        <Link href="/organizations">
          <ArrowLeft />
          All organizations
        </Link>
      </Button>

      <PageHeader
        title={organization.name}
        description={organization.description || 'No description provided.'}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">
            <KeyRound />
            {sources.length} credential{sources.length === 1 ? '' : 's'}
          </Badge>
          <Badge variant="neutral">
            <Building2 />
            Organization #{organization.id}
          </Badge>
          <Badge variant="neutral">
            <Clock3 />
            Updated {formatDateTime(organization.updatedAt)} by {organization.updatedBy}
          </Badge>
          <Badge variant="success">
            <ShieldCheck />
            AES-256-GCM at rest
          </Badge>
        </div>
      </PageHeader>

      {/* SourcesView reads `?source=` for deep links, so it needs a boundary. */}
      <Suspense fallback={<SourcesSkeleton />}>
        <SourcesView
          organizationId={organization.id}
          organizationName={organization.name}
          initialSources={sources}
          organizations={allOrganizations}
          role={user?.role ?? 'viewer'}
          email={user?.email ?? ''}
        />
      </Suspense>
    </div>
  );
}

function SourcesSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full sm:max-w-sm" />
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
