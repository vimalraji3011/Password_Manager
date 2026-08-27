'use client';

import * as React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Surface primitives.
 *
 * `Card` is static; `MotionCard` adds the fade-in-and-lift entrance used across
 * the dashboard. They are separate so a list of 50 rows does not pay for 50
 * animation subscriptions when it does not need them.
 */

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { glass?: boolean }>(
  ({ className, glass = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border text-card-foreground shadow-sm',
        glass ? 'glass shadow-glass' : 'border-border bg-card',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export interface MotionCardProps extends HTMLMotionProps<'div'> {
  glass?: boolean;
  /** Stagger index — each card enters slightly after the previous one. */
  index?: number;
  /** Lift and glow on hover. */
  hoverable?: boolean;
}

const MotionCard = React.forwardRef<HTMLDivElement, MotionCardProps>(
  ({ className, glass = false, index = 0, hoverable = false, ...props }, ref) => (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.4), ease: [0.22, 1, 0.36, 1] }}
      whileHover={hoverable ? { y: -4 } : undefined}
      className={cn(
        'rounded-xl border text-card-foreground shadow-sm',
        glass ? 'glass shadow-glass' : 'border-border bg-card',
        hoverable && 'cursor-pointer transition-shadow hover:shadow-lift',
        className,
      )}
      {...props}
    />
  ),
);
MotionCard.displayName = 'MotionCard';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-5 sm:p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-base font-semibold leading-none tracking-tight sm:text-lg', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, MotionCard, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
