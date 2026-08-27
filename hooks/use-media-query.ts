'use client';

import * as React from 'react';

/**
 * Subscribe to a CSS media query from JS.
 *
 * Returns `false` during SSR and on the first client render, then settles to the
 * real value in a layout effect — that avoids a hydration mismatch while still
 * updating before the browser paints.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind `lg` breakpoint — the point where the sidebar becomes permanent. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
/** Tailwind `md` — tablet and up. */
export const useIsTablet = () => useMediaQuery('(min-width: 768px)');
