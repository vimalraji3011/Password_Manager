'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

/**
 * Turns one-shot query flags into toasts, then strips them from the URL.
 *
 * Middleware cannot render UI, so when it blocks a viewer from an admin page it
 * redirects with `?denied=1` and this component explains what happened. Removing
 * the flag afterwards stops the toast from firing again on refresh or Back.
 */
export function RouteNotices() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Guard against React 18 double-invoking effects in development, which would
  // otherwise show every notice twice.
  const shown = React.useRef<string | null>(null);

  React.useEffect(() => {
    const denied = params.get('denied');
    if (!denied) return;

    const key = `${pathname}?denied=${denied}`;
    if (shown.current === key) return;
    shown.current = key;

    toast.warning('Access denied', {
      description: 'That page is available to System Admins only.',
    });

    const next = new URLSearchParams(params.toString());
    next.delete('denied');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [params, pathname, router]);

  return null;
}
