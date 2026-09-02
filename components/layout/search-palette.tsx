'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, KeyRound, Loader2, Search, SearchX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { apiFetch } from '@/hooks/use-api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn, hostnameOf } from '@/lib/utils';
import type { OrganizationWithCount, SafeSource } from '@/types';

/**
 * Global search palette (Ctrl/Cmd + K).
 *
 * Keyboard-first: arrow keys move a flat cursor across both result groups and
 * Enter navigates. Queries are debounced and every in-flight request is aborted
 * when a newer one starts, so results can never arrive out of order.
 */

interface SearchResults {
  organizations: OrganizationWithCount[];
  sources: Array<SafeSource & { organizationName: string }>;
  totals?: { organizations: number; sources: number };
}

type Row =
  | { kind: 'org'; id: number; label: string; sub: string; href: string }
  | { kind: 'source'; id: number; label: string; sub: string; href: string };

export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);

  const debounced = useDebouncedValue(query, 220);

  // Reset when the palette closes so it never reopens showing stale results.
  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(null);
      setCursor(0);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    const trimmed = debounced.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    apiFetch<SearchResults>(`/api/search?q=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        setResults(data);
        setCursor(0);
      })
      .catch((error: unknown) => {
        // An aborted request is the expected outcome of typing another key.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setResults({ organizations: [], sources: [] });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debounced, open]);

  // One flat list keeps arrow-key navigation simple across both groups.
  const rows: Row[] = React.useMemo(() => {
    if (!results) return [];
    return [
      ...results.organizations.map(
        (org): Row => ({
          kind: 'org',
          id: org.id,
          label: org.name,
          sub: `${org.sourceCount} credential${org.sourceCount === 1 ? '' : 's'}`,
          href: `/organizations/${org.id}`,
        }),
      ),
      ...results.sources.map(
        (source): Row => ({
          kind: 'source',
          id: source.id,
          label: source.source,
          sub: [source.organizationName, source.username, source.url ? hostnameOf(source.url) : null]
            .filter(Boolean)
            .join(' · '),
          href: `/organizations/${source.organizationId}?source=${source.id}`,
        }),
      ),
    ];
  }, [results]);

  function go(row: Row) {
    onOpenChange(false);
    router.push(row.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (rows.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (c + 1) % rows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[cursor];
      if (row) go(row);
    }
  }

  const orgCount = results?.organizations.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="top-[12%] max-w-xl translate-y-0 gap-0 p-0"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">Search the vault</DialogTitle>

        <div className="flex items-center gap-3 border-b border-border/70 px-4">
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search organizations, sources, usernames, URLs…"
            aria-label="Search the vault"
            className="h-14 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[min(60dvh,26rem)] overflow-y-auto p-2">
          {!query.trim() ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Start typing to search the vault.
            </p>
          ) : rows.length === 0 && !loading ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <SearchX className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nothing matches <span className="font-medium text-foreground">{query}</span>.
              </p>
            </div>
          ) : (
            <>
              {orgCount > 0 ? (
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Organizations
                </p>
              ) : null}

              {rows.map((row, index) => (
                <React.Fragment key={`${row.kind}-${row.id}`}>
                  {row.kind === 'source' && index === orgCount ? (
                    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Credentials
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => go(row)}
                    onMouseEnter={() => setCursor(index)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      index === cursor ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg',
                        row.kind === 'org'
                          ? 'bg-indigo-500/12 text-indigo-500'
                          : 'bg-violet-500/12 text-violet-500',
                      )}
                    >
                      {row.kind === 'org' ? (
                        <Building2 className="size-4" />
                      ) : (
                        <KeyRound className="size-4" />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{row.sub}</span>
                    </span>

                    <Badge variant="neutral" className="shrink-0 text-[10px]">
                      {row.kind === 'org' ? 'Organization' : 'Credential'}
                    </Badge>
                  </button>
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
            <Kbd>Enter</Kbd> open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium">
      {children}
    </kbd>
  );
}
