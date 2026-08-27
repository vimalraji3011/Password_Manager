import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 404 page. Deliberately vague about what does or does not exist — an internal
 * vault should not confirm the id of a record to someone poking at URLs.
 */
export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 aurora" aria-hidden />

      <div className="glass relative z-10 w-full max-w-md rounded-2xl p-8 text-center shadow-glass">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <FileQuestion className="size-7" />
        </div>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The page you asked for does not exist, or you do not have access to it.
        </p>

        <Button asChild variant="gradient" className="mt-6 w-full">
          <Link href="/dashboard">
            <Home />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
