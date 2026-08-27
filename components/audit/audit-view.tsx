'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  ScrollText,
  Search,
  SearchX,
  User2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AUDIT_PAGE_SIZE } from '@/lib/constants';
import { contains, formatDateTime, relativeTime } from '@/lib/utils';
import type { AuditAction, AuditEntry } from '@/types';

/**
 * Audit log browser.
 *
 * Filtering and pagination are client-side over the full log handed down by the
 * server. That is the right call at this scale — the writer caps the file at
 * 5,000 entries — and it makes filtering feel instant. If the log ever needs to
 * grow past that, `/api/audit` already accepts the same filters server-side.
 */

/** Mirrors `ACTION_META` but as plain data, so this stays a client component. */
const ACTION_LABELS: Record<AuditAction, { label: string; tone: BadgeTone }> = {
  LOGIN: { label: 'Signed in', tone: 'success' },
  LOGIN_FAILED: { label: 'Failed sign-in', tone: 'danger' },
  LOGOUT: { label: 'Signed out', tone: 'neutral' },
  PASSWORD_VIEWED: { label: 'Password revealed', tone: 'warning' },
  PASSWORD_UPDATED: { label: 'Password updated', tone: 'info' },
  SOURCE_CREATED: { label: 'Source created', tone: 'success' },
  SOURCE_UPDATED: { label: 'Source updated', tone: 'info' },
  SOURCE_DELETED: { label: 'Source deleted', tone: 'danger' },
  ORGANIZATION_CREATED: { label: 'Organization created', tone: 'success' },
  ORGANIZATION_UPDATED: { label: 'Organization updated', tone: 'info' },
  ORGANIZATION_DELETED: { label: 'Organization deleted', tone: 'danger' },
  RESET_REQUESTED: { label: 'Reset requested', tone: 'warning' },
  RESET_APPROVED: { label: 'Reset approved', tone: 'success' },
  RESET_REJECTED: { label: 'Reset rejected', tone: 'danger' },
  RESET_COMPLETED: { label: 'Reset completed', tone: 'success' },
  USER_PASSWORD_RESET: { label: 'User password reset', tone: 'warning' },
  PROFILE_UPDATED: { label: 'Profile updated', tone: 'info' },
};

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Grouped so the long action list stays navigable in the dropdown. */
const ACTION_GROUPS: Array<{ label: string; actions: AuditAction[] }> = [
  { label: 'Access', actions: ['LOGIN', 'LOGIN_FAILED', 'LOGOUT'] },
  { label: 'Credentials', actions: ['PASSWORD_VIEWED', 'PASSWORD_UPDATED', 'SOURCE_CREATED', 'SOURCE_UPDATED', 'SOURCE_DELETED'] },
  { label: 'Organizations', actions: ['ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'ORGANIZATION_DELETED'] },
  {
    label: 'Resets',
    actions: ['RESET_REQUESTED', 'RESET_APPROVED', 'RESET_REJECTED', 'RESET_COMPLETED', 'USER_PASSWORD_RESET'],
  },
  { label: 'Account', actions: ['PROFILE_UPDATED'] },
];

export function AuditView({ entries }: { entries: AuditEntry[] }) {
  const [search, setSearch] = React.useState('');
  const [action, setAction] = React.useState<AuditAction | 'ALL'>('ALL');
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(() => {
    const result = entries.filter((entry) => {
      if (action !== 'ALL' && entry.action !== action) return false;
      if (!search) return true;
      return (
        contains(entry.userName, search) ||
        contains(entry.userEmail, search) ||
        contains(entry.organization, search) ||
        contains(entry.source, search) ||
        contains(entry.detail, search) ||
        contains(entry.ip, search) ||
        contains(ACTION_LABELS[entry.action]?.label, search)
      );
    });
    return result;
  }, [entries, search, action]);

  // Any filter change invalidates the current page offset.
  React.useEffect(() => setPage(0), [search, action]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / AUDIT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * AUDIT_PAGE_SIZE, (safePage + 1) * AUDIT_PAGE_SIZE);

  const hasFilters = Boolean(search) || action !== 'ALL';

  return (
    <>
      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search user, source, IP, detail…"
            aria-label="Search the audit log"
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

        <Select value={action} onValueChange={(value) => setAction(value as AuditAction | 'ALL')}>
          <SelectTrigger className="w-full sm:w-[236px]" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All actions</SelectItem>
            {ACTION_GROUPS.map((group) => (
              <React.Fragment key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.actions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ACTION_LABELS[value].label}
                  </SelectItem>
                ))}
              </React.Fragment>
            ))}
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              setAction('ALL');
            }}
            className="shrink-0 text-muted-foreground"
          >
            <X />
            Clear filters
          </Button>
        ) : null}
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {hasFilters
          ? `${filtered.length} of ${entries.length} entries match`
          : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} recorded`}
        {pageCount > 1 ? ` · page ${safePage + 1} of ${pageCount}` : ''}
      </p>

      {entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="Nothing recorded yet"
          description="Sign-ins, credential changes and password reveals will appear here as they happen."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No matching entries"
          description="Try a different search term or clear the action filter."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setAction('ALL');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card/60 lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {visible.map((entry) => {
                  const meta = ACTION_LABELS[entry.action] ?? {
                    label: entry.action,
                    tone: 'neutral' as BadgeTone,
                  };

                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge variant={meta.tone}>{meta.label}</Badge>
                      </TableCell>

                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{entry.userName}</p>
                          <p className="truncate text-xs text-muted-foreground">{entry.userEmail}</p>
                        </div>
                      </TableCell>

                      <TableCell>
                        {entry.organization || entry.source ? (
                          <div className="min-w-0">
                            {entry.source ? (
                              <p className="truncate text-sm font-medium">{entry.source}</p>
                            ) : null}
                            {entry.organization ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {entry.organization}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <span className="block max-w-[18rem] truncate text-sm text-muted-foreground">
                          {entry.detail || '—'}
                        </span>
                      </TableCell>

                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{entry.ip}</span>
                      </TableCell>

                      <TableCell className="text-right">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {relativeTime(entry.createdAt)}
                          <span className="block">{formatDateTime(entry.createdAt)}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile / tablet: timeline cards */}
          <ol className="space-y-3 lg:hidden">
            {visible.map((entry, index) => {
              const meta = ACTION_LABELS[entry.action] ?? {
                label: entry.action,
                tone: 'neutral' as BadgeTone,
              };

              return (
                <motion.li
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.25) }}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant={meta.tone}>{meta.label}</Badge>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(entry.createdAt)}
                    </span>
                  </div>

                  <p className="mt-2.5 flex items-center gap-1.5 text-sm font-medium">
                    <User2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.userName}</span>
                  </p>

                  {entry.organization || entry.source ? (
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {[entry.organization, entry.source].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}

                  {entry.detail ? (
                    <p className="mt-2 rounded-lg bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
                      {entry.detail}
                    </p>
                  ) : null}

                  <p className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-mono">
                      <Globe className="size-3.5" />
                      {entry.ip}
                    </span>
                    <span>{formatDateTime(entry.createdAt)}</span>
                  </p>
                </motion.li>
              );
            })}
          </ol>

          {pageCount > 1 ? (
            <div className="mt-5 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={safePage === 0}
              >
                <ChevronLeft />
                Previous
              </Button>

              <span className="text-sm text-muted-foreground">
                Page {safePage + 1} of {pageCount}
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                disabled={safePage >= pageCount - 1}
              >
                Next
                <ChevronRight />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
