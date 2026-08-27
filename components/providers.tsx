'use client';

import * as React from 'react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Client-side provider stack, mounted once in the root layout.
 *
 * `next-themes` writes the theme class onto <html> before paint, so there is no
 * flash of the wrong theme. Toasts live here too, which is what lets any
 * component call `toast()` without wiring up a context of its own.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300} skipDelayDuration={0}>
        {children}
        <Toaster
          position="top-right"
          closeButton
          richColors
          duration={4000}
          toastOptions={{
            classNames: {
              toast: 'rounded-xl border border-border shadow-lift',
              title: 'text-sm font-semibold',
              description: 'text-sm text-muted-foreground',
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
