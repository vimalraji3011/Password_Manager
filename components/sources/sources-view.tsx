'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AtSign,
  ExternalLink,
  Eye,
  EyeOff,
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
import { CopyButton } from '@/components/ui/copy-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Hint } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { RevealDialog } from '@/components/sources/reveal-dialog';
import { SourceDialog } from '@/components/sources/source-dialog';
import { apiFetch, useMutation } from '@/hooks/use-api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { MASKED_PASSWORD, cn, contains, hostnameOf, relativeTime } from '@/lib/utils';
import type { Organization, Role, SafeSource } from '@/types';

/**
 * Credential list for one organization.
 *
 * Two presentations of the same data: a table from `md` up, and stacked cards
 * below it. That is a genuinely better answer than a horizontally scrolling
 * table on a phone, where the reveal and copy actions are the whole point and
 * must stay reachable without sideways scrolling.
 */
export function SourcesView({
  organizationId,
  organizationName,
  initialSources,
  organizations,
  role,
}: {
  organizationId: number;
  organizationName: string;
  initialSources: SafeSource[];
  organizations: Organization[];
  role: Role;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const isAdmin = role === 'admin';

  const [sources, setSources] = React.useState(initialSources);
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SafeSource | null>(null);
  const [deleting, setDeleting] = React.useState<SafeSource | null>(null);
  const [revealing, setRevealing] = React.useState<SafeSource | null>(null);

  // Deep link from the dashboard / search palette: ?source=<id> highlights a row.
  const highlightId = Number(params.get('source')) || null;
  const highlightRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!highlightId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId]);

  const refresh = React.useCallback(async () => {
    const data = await apiFetch<SafeSource[]>(`/api/sources?organizationId=${organizationId}`);
    setSources(data);
    router.refresh();
  }, [organizationId, router]);

  const remove = useMutation((id: number) =>
    apiFetch<{ deleted: true }>(`/api/sources/${id}`, { method: 'DELETE' }),
  );

  const visible = React.useMemo(
    () =>
      sources
        .filter(
          (source) =>
            contains(source.source, debouncedSearch) ||
            contains(source.username, debouncedSearch) ||
            contains(source.url, debouncedSearch) ||
            contains(source.notes, debouncedSearch),
        )
        .sort((a, b) => a.source.localeCompare(b.source)),
    [sources, debouncedSearch],
  );

  /** Shared action cluster, so table and card views cannot diverge. */
  function Actions({ source, className }: { source: SafeSource; className?: string }) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {isAdmin ? (
          <Hint label="Reveal password">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setRevealing(source)}
              aria-label={`Reveal password for ${source.source}`}
            >
              <Eye />
            </Button>
          </Hint>
        ) : (
          <Hint label="Viewer accounts cannot reveal passwords">
            {/* A disabled button swallows pointer events, so the tooltip needs a
                wrapper that can still receive them. */}
            <span className="inline-flex">
              <Button variant="ghost" size="icon-sm" disabled aria-label="Reveal is not available">
                <EyeOff />
              </Button>
            </span>
          </Hint>
        )}

        <CopyButton value={source.username} label="Copy username" successMessage="Username copied" />

        {source.url ? (
          <Hint label="Open site">
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={source.url}
                target="_blank"
                // noreferrer as well as noopener: no reason to leak the vault URL.
                rel="noopener noreferrer"
                aria-label={`Open ${source.source}`}
              >
                <ExternalLink />
              </a>
            </Button>
          </Hint>
        ) : null}

        {isAdmin ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={`More actions for ${source.source}`}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(source)}>
                <Pencil />
                Edit credential
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRevealing(source)}>
                <Eye />
                Reveal password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setDeleting(source)}>
                <Trash2 />
                Delete credential
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sources, usernames, URLs…"
            aria-label="Search credentials"
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

        {isAdmin ? (
          <Button variant="gradient" onClick={() => setCreateOpen(true)} className="sm:ml-auto">
            <Plus />
            Add credential
          </Button>
        ) : null}
      </div>

      {sources.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title="No credentials yet"
          description={
            isAdmin
              ? `Add the first credential for ${organizationName}. It is encrypted before it is stored.`
              : `${organizationName} has no credentials stored yet.`
          }
          action={
            isAdmin ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Add credential
              </Button>
            ) : null
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No matches"
          description={`Nothing in ${organizationName} matches "${debouncedSearch}".`}
          action={
            <Button variant="outline" onClick={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card/60 md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Source</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Password</TableHead>
                  <TableHead className="hidden lg:table-cell">URL</TableHead>
                  <TableHead className="hidden xl:table-cell">Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {visible.map((source) => (
                  <TableRow
                    key={source.id}
                    ref={source.id === highlightId ? (highlightRef as React.Ref<HTMLTableRowElement>) : undefined}
                    className={cn(source.id === highlightId && 'bg-accent/60')}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-500">
                          <KeyRound className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{source.source}</p>
                          {source.notes ? (
                            <p className="max-w-[16rem] truncate text-xs text-muted-foreground">
                              {source.notes}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <AtSign className="size-3.5 shrink-0" />
                        <span className="max-w-[14rem] truncate">{source.username}</span>
                      </span>
                    </TableCell>

                    {/* Always masked in list views. */}
                    <TableCell>
                      <span className="credential text-muted-foreground">{MASKED_PASSWORD}</span>
                    </TableCell>

                    <TableCell className="hidden lg:table-cell">
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary underline-offset-4 hover:underline"
                        >
                          {hostnameOf(source.url)}
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="hidden xl:table-cell">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {relativeTime(source.updatedAt)}
                        <span className="block">by {source.updatedBy}</span>
                      </span>
                    </TableCell>

                    <TableCell>
                      <Actions source={source} className="justify-end" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            <AnimatePresence mode="popLayout">
              {visible.map((source, index) => (
                <motion.article
                  key={source.id}
                  ref={source.id === highlightId ? (highlightRef as React.Ref<HTMLElement>) : undefined}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
                  className={cn(
                    'rounded-xl border border-border bg-card p-4',
                    source.id === highlightId && 'ring-2 ring-primary/50',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-500">
                      <KeyRound className="size-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{source.source}</p>
                      <p className="truncate text-sm text-muted-foreground">{source.username}</p>
                    </div>
                  </div>

                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Password</dt>
                      <dd className="credential text-muted-foreground">{MASKED_PASSWORD}</dd>
                    </div>
                    {source.url ? (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">URL</dt>
                        <dd className="min-w-0 truncate">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {hostnameOf(source.url)}
                          </a>
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Updated</dt>
                      <dd className="text-xs text-muted-foreground">
                        {relativeTime(source.updatedAt)} by {source.updatedBy}
                      </dd>
                    </div>
                  </dl>

                  {source.notes ? (
                    <p className="mt-3 rounded-lg bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
                      {source.notes}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                    <Badge variant="neutral" className="text-[10px]">
                      AES-256-GCM
                    </Badge>
                    <Actions source={source} />
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </div>

          {debouncedSearch ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {visible.length} of {sources.length} credential{sources.length === 1 ? '' : 's'} match{' '}
              <span className="font-medium text-foreground">{debouncedSearch}</span>
            </p>
          ) : null}
        </>
      )}

      {/* Reveal is available to admins only; the dialog itself re-checks. */}
      <RevealDialog
        source={revealing}
        open={Boolean(revealing)}
        onOpenChange={(open) => !open && setRevealing(null)}
      />

      {isAdmin ? (
        <>
          <SourceDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            organizations={organizations}
            defaultOrganizationId={organizationId}
            onSaved={refresh}
          />

          <SourceDialog
            open={Boolean(editing)}
            onOpenChange={(open) => !open && setEditing(null)}
            source={editing}
            organizations={organizations}
            defaultOrganizationId={organizationId}
            onSaved={refresh}
          />

          <ConfirmDialog
            open={Boolean(deleting)}
            onOpenChange={(open) => !open && setDeleting(null)}
            title={`Delete ${deleting?.source ?? 'credential'}?`}
            confirmLabel="Delete credential"
            loading={remove.submitting}
            description={
              <>
                This permanently deletes the{' '}
                <span className="font-semibold text-foreground">{deleting?.source}</span> credential
                for <span className="font-semibold text-foreground">{deleting?.username}</span>. The
                encrypted password is destroyed and cannot be recovered.
              </>
            }
            onConfirm={async () => {
              if (!deleting) return;
              await remove.run(deleting.id, {
                successMessage: `${deleting.source} deleted`,
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
