'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Shown wherever a list has nothing in it. Keeping it in one component means
 * "no organizations yet" and "no results for your search" look and behave the
 * same everywhere.
 *
 * `icon` is a rendered element rather than a component reference so server
 * components can use this too — functions are not serialisable across the
 * server/client boundary.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-6">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </motion.div>
  );
}
