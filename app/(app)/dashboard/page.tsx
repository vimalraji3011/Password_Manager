import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  Building2,
  Clock3,
  Eye,
  KeyRound,
  Plus,
  ScrollText,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { ACTION_META, listAudit } from '@/lib/audit';
import { getCurrentUser } from '@/lib/auth';
import { getDashboardStats, resetRequests } from '@/lib/repository';
import { MASKED_PASSWORD, formatDateTime, hostnameOf, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Dashboard.
 *
 * A server component: it reads the JSON store directly rather than calling its
 * own API over HTTP, so the page renders in one pass with no client-side
 * loading state. Everything here is read-only, so a viewer sees the same
 * layout as an admin minus the admin-only tiles and actions.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === 'admin';

  const [stats, recentAudit, pendingRequests] = await Promise.all([
    getDashboardStats(),
    // Viewers have no audit access, so do not even read the log for them.
    isAdmin ? listAudit({ limit: 8 }) : Promise.resolve([]),
    resetRequests.filter((item) => item.status === 'PENDING'),
  ]);

  const reveals = isAdmin
    ? await listAudit({ action: 'PASSWORD_VIEWED' }).then((entries) => {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return entries.filter((entry) => new Date(entry.createdAt).getTime() >= cutoff).length;
      })
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user?.name.split(' ')[0] ?? 'there'}`}
        description={
          isAdmin
            ? 'Everything in the vault at a glance. Credentials stay encrypted until you explicitly reveal them.'
            : 'You have read-only access. Credential values are hidden and cannot be revealed with a Viewer account.'
        }
        actions={
          isAdmin ? (
            <Button asChild variant="gradient">
              <Link href="/organizations?new=1">
                <Plus />
                New organization
              </Link>
            </Button>
          ) : null
        }
      />

      {/* Pending approvals need to be impossible to miss. */}
      {isAdmin && pendingRequests.length > 0 ? (
        <Link
          href="/reset-view-password"
          className="flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/8 p-4 transition-colors hover:bg-warning/12"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {pendingRequests.length} reset request{pendingRequests.length === 1 ? '' : 's'} waiting
              for your approval
            </p>
            <p className="text-sm text-muted-foreground">
              Requested by{' '}
              {pendingRequests
                .slice(0, 2)
                .map((request) => request.userName)
                .join(', ')}
              {pendingRequests.length > 2 ? ` and ${pendingRequests.length - 2} more` : ''}.
            </p>
          </div>
          <Badge variant="warning" className="shrink-0">
            Review
          </Badge>
        </Link>
      ) : null}

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          index={0}
          label="Organizations"
          value={stats.organizationCount}
          hint="Grouped credential owners"
          icon={<Building2 />}
          accent="indigo"
          href="/organizations"
        />
        <StatCard
          index={1}
          label="Credential sources"
          value={stats.sourceCount}
          hint="All encrypted with AES-256-GCM"
          icon={<KeyRound />}
          accent="violet"
          href="/organizations"
        />
        {isAdmin ? (
          <>
            <StatCard
              index={2}
              label="Reveals this week"
              value={reveals}
              hint="Password views in the last 7 days"
              icon={<Eye />}
              accent="amber"
              href="/audit"
            />
            <StatCard
              index={3}
              label="Audit entries"
              value={(await listAudit()).length}
              hint="Complete, append-only history"
              icon={<ScrollText />}
              accent="emerald"
              href="/audit"
            />
          </>
        ) : (
          <>
            <StatCard
              index={2}
              label="Your access"
              value="Read-only"
              hint="Reveal and edit are disabled"
              icon={<Eye />}
              accent="amber"
            />
            <StatCard
              index={3}
              label="Last sign-in"
              value={user?.lastLogin ? relativeTime(user.lastLogin) : 'First visit'}
              hint={formatDateTime(user?.lastLogin)}
              icon={<Clock3 />}
              accent="emerald"
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recently updated credentials */}
        <Card glass className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>Recently updated</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/organizations">View all</Link>
            </Button>
          </CardHeader>

          <CardContent>
            {stats.recentlyUpdated.length === 0 ? (
              <EmptyState
                icon={<KeyRound />}
                title="No credentials yet"
                description={
                  isAdmin
                    ? 'Create an organization, then add its first credential source.'
                    : 'Nothing has been added to the vault yet.'
                }
                action={
                  isAdmin ? (
                    <Button asChild size="sm">
                      <Link href="/organizations?new=1">
                        <Plus />
                        New organization
                      </Link>
                    </Button>
                  ) : null
                }
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {stats.recentlyUpdated.map((source) => (
                  <li key={source.id}>
                    <Link
                      href={`/organizations/${source.organizationId}?source=${source.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-accent/50"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-500">
                        <KeyRound className="size-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm font-medium">
                          {source.source}
                          <span className="text-xs font-normal text-muted-foreground">
                            {source.organizationName}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {source.username}
                          {source.url ? ` · ${hostnameOf(source.url)}` : ''}
                        </p>
                      </div>

                      {/* Masked everywhere by default — revealing is deliberate. */}
                      <span className="credential hidden shrink-0 text-muted-foreground sm:block">
                        {MASKED_PASSWORD}
                      </span>

                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(source.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          <Card glass>
            <CardHeader>
              <CardTitle>Largest organizations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.topOrganizations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
              ) : (
                stats.topOrganizations.map((org) => {
                  const max = stats.topOrganizations[0]?.sourceCount || 1;
                  const width = Math.max(6, Math.round((org.sourceCount / max) * 100));

                  return (
                    <Link key={org.id} href={`/organizations/${org.id}`} className="block space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{org.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {org.sourceCount}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>Audit summary</CardTitle>
              {isAdmin ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/audit">Open</Link>
                </Button>
              ) : null}
            </CardHeader>

            <CardContent>
              {!isAdmin ? (
                <p className="text-sm text-muted-foreground">
                  Audit history is available to System Admins.
                </p>
              ) : recentAudit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {recentAudit.slice(0, 6).map((entry) => {
                    const meta = ACTION_META[entry.action];
                    return (
                      <li key={entry.id} className="flex items-start gap-2.5">
                        <Activity className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            <Badge variant={meta.tone} className="mr-1.5 align-middle text-[10px]">
                              {meta.label}
                            </Badge>
                            <span className="text-muted-foreground">{entry.userName}</span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[entry.organization, entry.source].filter(Boolean).join(' · ') ||
                              entry.detail ||
                              '—'}{' '}
                            · {relativeTime(entry.createdAt)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
