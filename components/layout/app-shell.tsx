'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { SearchPalette } from '@/components/layout/search-palette';
import type { SafeUser } from '@/types';

/** Remembers the collapsed rail across reloads. */
const COLLAPSE_KEY = 'opm:sidebar-collapsed';

/**
 * Client shell around every authenticated page.
 *
 * Owns the three pieces of UI state that outlive an individual page — sidebar
 * collapse, the mobile drawer, and the command palette — plus the page
 * transition. The authenticated user is passed down from the server layout so
 * no page has to fetch it.
 */
export function AppShell({ user, children }: { user: SafeUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  // Restore the preference after mount to avoid a hydration mismatch.
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Storage unavailable; the default (expanded) is fine.
    }
  }, []);

  const toggleCollapse = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Non-fatal.
      }
      return next;
    });
  }, []);

  const closeMobile = React.useCallback(() => setMobileOpen(false), []);

  // Ctrl/Cmd+K opens search from anywhere.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="relative flex min-h-dvh bg-background">
      {/* Ambient wash, fixed so it does not scroll with content. */}
      <div className="pointer-events-none fixed inset-0 aurora opacity-70" aria-hidden />

      <Sidebar
        user={user}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />

      {/* min-w-0 is what stops a wide table from widening the whole page. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          onOpenMobileNav={() => setMobileOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1400px]"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
