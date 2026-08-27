'use client';

import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { cn } from '@/lib/utils';

/**
 * Shared chrome for login / forgot-password / reset-password.
 *
 * The floating gradient blobs are three absolutely positioned, blurred divs
 * animated by CSS keyframes rather than JS — they cost nothing per frame and
 * stop entirely under `prefers-reduced-motion`. `pointer-events-none` keeps them
 * from stealing clicks from the form.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 aurora" aria-hidden />
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-60" aria-hidden />

      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-24 top-[-10%] size-[26rem] rounded-full bg-indigo-500/25 blur-3xl animate-blob" />
        <div
          className="absolute -right-20 top-[12%] size-[22rem] rounded-full bg-fuchsia-500/20 blur-3xl animate-blob"
          style={{ animationDelay: '-6s' }}
        />
        <div
          className="absolute bottom-[-12%] left-1/3 size-[24rem] rounded-full bg-sky-400/20 blur-3xl animate-blob"
          style={{ animationDelay: '-12s' }}
        />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-glow">
            <ShieldCheck className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Office Password Management</p>
            <p className="text-xs text-muted-foreground">Internal credential vault</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-12 pt-2 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className={cn('w-full max-w-md', className)}
        >
          <div className="glass rounded-2xl p-6 shadow-glass sm:p-8">
            <div className="mb-6 space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-gradient sm:text-[26px]">
                {title}
              </h1>
              {subtitle ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>

            {children}
          </div>

          {footer ? <div className="mt-5 text-center text-sm">{footer}</div> : null}
        </motion.div>
      </main>

      <footer className="relative z-10 px-5 pb-6 text-center text-xs text-muted-foreground sm:px-8">
        Credentials are encrypted with AES-256-GCM. Access is logged.
      </footer>
    </div>
  );
}
