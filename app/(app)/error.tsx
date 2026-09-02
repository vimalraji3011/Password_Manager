'use client';

import { useEffect } from 'react';
import { AlertOctagon, Home, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Error boundary for authenticated pages. Keeps the sidebar and topbar intact,
 * so a failure on one page does not strand the user with no way out.
 *
 * Configuration problems (a missing MASTER_ENCRYPTION_KEY, for instance) are
 * shown verbatim because they are actionable and contain no secrets. Anything
 * else is replaced with a generic message.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[page]', error);
  }, [error]);

  const isConfigError = /MASTER_ENCRYPTION_KEY|JWT_SECRET|SMTP/.test(error.message);

  return (
    <Card glass className="mx-auto max-w-lg">
      <CardContent className="pt-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/12 text-destructive">
          <AlertOctagon className="size-7" />
        </div>

        <h1 className="mt-5 text-xl font-semibold tracking-tight">
          {isConfigError ? 'Configuration problem' : 'This page could not be loaded'}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {isConfigError
            ? error.message
            : 'Something went wrong while loading this page. Nothing in the vault has been changed.'}
        </p>

        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="outline" asChild>
            <Link href="/dashboard">
              <Home />
              Dashboard
            </Link>
          </Button>
          <Button variant="gradient" onClick={reset}>
            <RotateCcw />
            Try again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
