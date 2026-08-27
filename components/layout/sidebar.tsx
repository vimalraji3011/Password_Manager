'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsLeft, ShieldCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { isActive, navFor } from '@/components/layout/nav-config';
import { cn } from '@/lib/utils';
import type { SafeUser } from '@/types';

/**
 * Application sidebar.
 *
 * One component serves two presentations:
 *  - desktop (lg and up): permanent rail, collapsible to icons only
 *  - mobile/tablet: off-canvas drawer over a backdrop
 *
 * The active-item highlight is a shared `layoutId` pill, so it slides between
 * items instead of blinking — the effect Linear and Vercel use.
 */
export function Sidebar({
  user,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: {
  user: SafeUser;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const sections = React.useMemo(() => navFor(user.role), [user.role]);

  // Close the drawer whenever the route changes, so tapping a link on a phone
  // does not leave the overlay covering the page it just opened.
  React.useEffect(() => {
    onCloseMobile();
  }, [pathname, onCloseMobile]);

  // Escape closes the drawer — expected behaviour for anything modal.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMobile();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  // Lock body scroll behind the drawer.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const content = (
    <div className="flex h-full flex-col gap-1">
      {/* Brand */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center gap-2.5 px-4',
          collapsed && 'lg:justify-center lg:px-2',
        )}
      >
        <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden rounded-lg">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-glow">
            <ShieldCheck className="size-5" />
          </span>
          <AnimatePresence initial={false}>
            {collapsed ? null : (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18 }}
                className="min-w-0 leading-tight"
              >
                <span className="block truncate text-sm font-semibold">Password Vault</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  Office Management
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </Link>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onCloseMobile}
          className="ml-auto lg:hidden"
          aria-label="Close navigation"
        >
          <X />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2" aria-label="Main">
        {sections.map((section) => (
          <div key={section.title} className="mb-4">
            <p
              className={cn(
                'px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80',
                collapsed && 'lg:text-center lg:tracking-normal',
              )}
            >
              {collapsed ? <span className="lg:hidden">{section.title}</span> : section.title}
            </p>

            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);

                const link = (
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      collapsed && 'lg:justify-center lg:px-0',
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="sidebar-active-pill"
                        className="absolute inset-0 -z-10 rounded-lg bg-accent"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    ) : null}

                    <item.icon
                      className={cn(
                        'size-[18px] shrink-0 transition-colors',
                        active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                      )}
                    />

                    <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>

                    {item.adminOnly && !collapsed ? (
                      <Badge variant="neutral" className="ml-auto px-1.5 py-0 text-[10px]">
                        Admin
                      </Badge>
                    ) : null}
                  </Link>
                );

                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <>
                        <span className="hidden lg:block">
                          <Hint label={item.label} side="right">
                            {link}
                          </Hint>
                        </span>
                        <span className="lg:hidden">{link}</span>
                      </>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Role footer + collapse control */}
      <div className="shrink-0 border-t border-border/70 p-2.5">
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2',
            collapsed && 'lg:justify-center',
          )}
        >
          <Badge
            variant={user.role === 'admin' ? 'default' : 'neutral'}
            className={cn('shrink-0', collapsed && 'lg:px-1.5')}
          >
            {collapsed ? (
              <>
                <span className="lg:hidden">
                  {user.role === 'admin' ? 'System Admin' : 'Viewer'}
                </span>
                <span className="hidden lg:inline">{user.role === 'admin' ? 'A' : 'V'}</span>
              </>
            ) : user.role === 'admin' ? (
              'System Admin'
            ) : (
              'Viewer'
            )}
          </Badge>

          {collapsed ? null : (
            <span className="truncate text-xs text-muted-foreground">
              {user.role === 'admin' ? 'Full access' : 'Read-only access'}
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className={cn(
            'mt-1.5 hidden w-full justify-start text-muted-foreground lg:flex',
            collapsed && 'lg:justify-center',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronsLeft className={cn('transition-transform duration-300', collapsed && 'rotate-180')} />
          {collapsed ? null : 'Collapse'}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 76 : 264 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-30 hidden h-dvh shrink-0 border-r border-border/70 bg-card/60 backdrop-blur-xl lg:block"
      >
        {content}
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onCloseMobile}
              className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm lg:hidden"
              aria-hidden
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 w-[min(84vw,288px)] border-r border-border bg-card shadow-lift lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              {content}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
