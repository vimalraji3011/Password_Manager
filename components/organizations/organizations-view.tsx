'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Building2,
  Clock3,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MotionCard } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { OrganizationDialog } from '@/components/organizations/organization-dialog';
import { apiFetch, useMutation } from '@/hooks/use-api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { contains, formatDate, relativeTime } from '@/lib/utils';
import type { OrganizationWithCount, Role } from '@/types';

/**
 * Organizations index.
 *
 * Data arrives pre-rendered from the server component and is kept in local
 * state, so search and sort are instant (no round trip) while mutations refetch
 * to stay authoritative. That trade-off is right for a two-user internal vault
 * where the whole list comfortably fits in memory.
 */
type SortValue = 'name-asc' | 'name-desc' | 'sources-desc' | 'updated-desc';

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'sources-desc', label: 'Most credentials' },
  { value: 'updated-desc', label: 'Recently updated' },
];

export function OrganizationsView({
  initialOrganizations,
  role,
}: {
  initialOrganizations: OrganizationWithCount[];
  role: Role;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const isAdmin = role === 'admin';

  const [organizations, setOrganizations] = React.useState(initialOrganizations);
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<SortValue>('name-asc');

  // `?new=1` (from the dashboard CTA) opens the create dialog on arrival.
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OrganizationWithCount | null>(null);
  const [deleting, setDeleting] = React.useState<OrganizationWithCount | null>(null);

  React.useEffect(() => {
    if (isAdmin && params.get('new') === '1') {
      setCreateOpen(true);
      // Strip the flag so a refresh does not reopen the dialog.
      router.replace('/organizations');
    }
  }, [params, router, isAdmin]);

  const debouncedSearch = useDebouncedValue(search, 200);

  const refresh = React.useCallback(async () => {
    const data = await apiFetch<OrganizationWithCount[]>('/api/organizations');
    setOrganizations(data);
    // Keep server-rendered pages (dashboard counts) in step.
    router.refresh();
  }, [router]);

  const remove = useMutation((id: number) =>
    apiFetch<{ deleted: true; removedSources: number }>(`/api/organizations/${id}`, {
      method: 'DELETE',
    }),
  );

  const visible = React.useMemo(() => {
    const filtered = organizations.filter(
      (org) => contains(org.name, debouncedSearch) || contains(org.description, debouncedSearch),
    );

    const sorted = [...filtered];
    switch (sort) {
      case 'name-desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'sources-desc':
        sorted.sort((a, b) => b.sourceCount - a.sourceCount || a.name.localeCompare(b.name));
        break;
      case 'updated-desc':
        sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        break;
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [organizations, debouncedSearch, sort]);

  const totalSources = organizations.reduce((sum, org) => sum + org.sourceCount, 0);

  return (
    <>
      {/* Toolbar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search organizations…"
            aria-label="Search organizations"
            icon={<Search />}
            trailing={
              search ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mr-1"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <X />
                </Button>
              ) : undefined
            }
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(value) => setSort(value as SortValue)}>
            <SelectTrigger className="w-full sm:w-[188px]" aria-label="Sort organizations">
              {sort.endsWith('asc') ? (
                <ArrowDownAZ className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ArrowUpAZ className="size-4 shrink-0 text-muted-foreground" />
              )}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isAdmin ? (
            <Button variant="gradient" onClick={() => setCreateOpen(true)} className="shrink-0">
              <Plus />
              <span className="hidden sm:inline">New organization</span>
              <span className="sm:hidden">New</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Summary line */}
      <p className="mb-4 text-sm text-muted-foreground">
        {debouncedSearch ? (
          <>
            {visible.length} of {organizations.length} organization
            {organizations.length === 1 ? '' : 's'} match{' '}
            <span className="font-medium text-foreground">{debouncedSearch}</span>
          </>
        ) : (
          <>
            {organizations.length} organization{organizations.length === 1 ? '' : 's'} ·{' '}
            {totalSources} credential{totalSources === 1 ? '' : 's'} stored
          </>
        )}
      </p>

      {/* Grid */}
      {organizations.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No organizations yet"
          description={
            isAdmin
              ? 'Create your first organization, then add the credentials that belong to it.'
              : 'Nothing has been added to the vault yet. Ask a System Admin to set it up.'
          }
          action={
            isAdmin ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                New organization
              </Button>
            ) : null
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No matches"
          description={`Nothing matches "${debouncedSearch}". Try a shorter search term.`}
          action={
            <Button variant="outline" onClick={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visible.map((org, index) => (
              <MotionCard
                key={org.id}
                glass
                index={index}
                layout
                exit={{ opacity: 0, scale: 0.96 }}
                className="group relative flex flex-col p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-transparent text-indigo-500">
                    <Building2 className="size-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/organizations/${org.id}`}
                      className="block truncate text-base font-semibold underline-offset-4 hover:underline"
                    >
                      {org.name}
                    </Link>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {org.description || 'No description'}
                    </p>
                  </div>

                  {isAdmin ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground"
                          aria-label={`Actions for ${org.name}`}
                        >
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(org)}>
                          <Pencil />
                          Edit details
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleting(org)}>
                          <Trash2 />
                          Delete organization
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <Badge variant="default">
                    <KeyRound />
                    {org.sourceCount} credential{org.sourceCount === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant="neutral">
                    <Clock3 />
                    {relativeTime(org.updatedAt)}
                  </Badge>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <span className="truncate">
                    Updated by <span className="font-medium">{org.updatedBy}</span>
                  </span>
                  <span className="shrink-0">{formatDate(org.updatedAt)}</span>
                </div>

                <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                  <Link href={`/organizations/${org.id}`}>
                    <KeyRound />
                    Open credentials
                  </Link>
                </Button>
              </MotionCard>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Create / edit */}
      {isAdmin ? (
        <>
          <OrganizationDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={refresh} />

          <OrganizationDialog
            open={Boolean(editing)}
            onOpenChange={(open) => !open && setEditing(null)}
            organization={editing}
            onSaved={refresh}
          />

          <ConfirmDialog
            open={Boolean(deleting)}
            onOpenChange={(open) => !open && setDeleting(null)}
            title={`Delete ${deleting?.name ?? 'organization'}?`}
            confirmLabel="Delete organization"
            // A cascading delete deserves a typed confirmation.
            confirmText={deleting && deleting.sourceCount > 0 ? deleting.name : undefined}
            loading={remove.submitting}
            description={
              <>
                This permanently deletes{' '}
                <span className="font-semibold text-foreground">{deleting?.name}</span>
                {deleting && deleting.sourceCount > 0 ? (
                  <>
                    {' '}
                    and all{' '}
                    <span className="font-semibold text-destructive">
                      {deleting.sourceCount} credential{deleting.sourceCount === 1 ? '' : 's'}
                    </span>{' '}
                    stored inside it
                  </>
                ) : null}
                . This cannot be undone, and every System Admin is notified.
              </>
            }
            onConfirm={async () => {
              if (!deleting) return;
              await remove.run(deleting.id, {
                successMessage: `${deleting.name} deleted`,
                onSuccess: async () => {
                  setDeleting(null);
                  await refresh();
                },
              });
            }}
          />
        </>
      ) : null}
    </>
  );
}
