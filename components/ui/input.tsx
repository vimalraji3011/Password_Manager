'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Icon rendered inside the field, on the left. */
  icon?: React.ReactNode;
  /** Slot on the right, typically a password-visibility toggle. */
  trailing?: React.ReactNode;
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, trailing, invalid, ...props }, ref) => {
    const field = (
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm shadow-sm transition-colors',
          'placeholder:text-muted-foreground/70',
          'focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          invalid && 'border-destructive/70 focus-visible:border-destructive focus-visible:ring-destructive/25',
          icon && 'pl-10',
          trailing && 'pr-10',
          className,
        )}
        {...props}
      />
    );

    if (!icon && !trailing) return field;

    return (
      <div className="relative">
        {icon ? (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        {field}
        {trailing ? (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      'flex min-h-[84px] w-full resize-y rounded-lg border border-input bg-background/60 px-3 py-2 text-sm shadow-sm transition-colors',
      'placeholder:text-muted-foreground/70',
      'focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
      'disabled:cursor-not-allowed disabled:opacity-60',
      invalid && 'border-destructive/70 focus-visible:ring-destructive/25',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Input, Textarea };
