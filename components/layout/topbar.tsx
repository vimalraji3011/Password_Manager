'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Menu, Search, ShieldCheck, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { apiFetch } from '@/hooks/use-api';
import { formatDateTime, initials } from '@/lib/utils';
import type { SafeUser } from '@/types';

/**
 * Sticky application header: menu trigger on small screens, global search,
 * theme switch and the account menu.
 */
export function Topbar({
  user,
  onOpenMobileNav,
  onOpenSearch,
}: {
  user: SafeUser;
  onOpenMobileNav: () => void;
  onOpenSearch: () => void;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      toast.success('Signed out');
      // `replace` + `refresh` clears the cached server components for this user.
      router.replace('/login');
      router.refresh();
    } catch {
      toast.error('Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
        >
          <Menu />
        </Button>

        {/* Global search. A button rather than an input: it opens the palette,
            which is a dialog, so a real input here would be misleading. */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="group flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-input bg-background/60 px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground sm:max-w-md"
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate">Search organizations, sources, usernames…</span>
          <kbd className="ml-auto hidden shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            Ctrl K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-10 gap-2 px-1.5 sm:px-2"
                aria-label="Account menu"
              >
                <Avatar className="size-8">
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
                <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
                  <span className="max-w-[9rem] truncate text-sm font-medium">{user.name}</span>
                  <span className="max-w-[9rem] truncate text-[11px] text-muted-foreground">
                    {user.role === 'admin' ? 'System Admin' : 'Viewer'}
                  </span>
                </span>
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
              <div className="px-2.5 pb-2">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Last sign-in: {formatDateTime(user.lastLogin)}
                </p>
              </div>

              <DropdownMenuSeparator />

              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <UserCircle2 />
                  My profile
                </Link>
              </DropdownMenuItem>

              <DropdownMenuItem asChild>
                <Link href="/reset-view-password">
                  <ShieldCheck />
                  Reveal-password help
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem destructive onSelect={signOut} disabled={signingOut}>
                <LogOut />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
