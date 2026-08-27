import { cn } from '@/lib/utils';

/** Loading placeholder. The shimmer comes from the `.skeleton` class in globals.css. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden {...props} />;
}

export { Skeleton };
