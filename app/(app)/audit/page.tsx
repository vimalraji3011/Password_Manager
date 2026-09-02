import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuditView } from '@/components/audit/audit-view';
import { PageHeader } from '@/components/shared/page-header';
import { listAudit } from '@/lib/audit';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Audit log' };

/**
 * Audit log.
 *
 * Middleware already blocks viewers, but this re-checks: the page reads the full
 * access history of the vault, so it should not depend on a single layer being
 * configured correctly.
 */
export default async function AuditPage() {
  const user = await getCurrentUser();
  if (user?.role !== 'admin') redirect('/dashboard?denied=1');

  const entries = await listAudit();

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every sign-in, credential change and password reveal, with the user, IP address and timestamp. Entries are append-only and cannot be edited or deleted from the UI."
      />

      <AuditView entries={entries} />
    </div>
  );
}
