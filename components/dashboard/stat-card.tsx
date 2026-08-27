'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Floating glass stat tile used across the top of the dashboard.
 *
 * `icon` is a rendered element, not a component reference: a function cannot
 * cross the server/client boundary, and the dashboard that uses this tile is a
 * server component. Sizing is applied by the wrapper via `[&_svg]`, so callers
 * just pass `<Icon />`.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  accent = 'indigo',
  index = 0,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  href?: string;
  accent?: 'indigo' | 'violet' | 'sky' | 'emerald' | 'amber';
  index?: number;
}) {
  const accents = {
    indigo: 'from-indigo-500/18 text-indigo-500',
    violet: 'from-violet-500/18 text-violet-500',
    sky: 'from-sky-500/18 text-sky-500',
    emerald: 'from-emerald-500/18 text-emerald-500',
    amber: 'from-amber-500/18 text-amber-500',
  } as const;

  const body = (
    <>
      {/* Soft corner glow, tinted per accent. */}
      <span
        className={cn(
          'pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-gradient-to-br to-transparent blur-2xl',
          accents[accent],
        )}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-xl bg-gradient-to-br to-transparent [&_svg]:size-5',
            accents[accent],
          )}
        >
          {icon}
        </span>

        {href ? (
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        ) : null}
      </div>

      <div className="relative mt-4 space-y-0.5">
        <p className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{value}</p>
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </>
  );

  const className =
    'group relative overflow-hidden rounded-xl glass p-5 shadow-glass transition-shadow hover:shadow-lift';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
    >
      {href ? (
        <Link href={href} className={cn(className, 'block')}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </motion.div>
  );
}
