'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/**
 * Labelled form field with inline validation.
 *
 * Wires up `htmlFor`/`id`/`aria-describedby` automatically so every field in
 * the app is accessible without each form remembering to do it. The error
 * message animates in rather than snapping, which stops the layout from
 * jumping as the user types.
 */
export interface FieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
  /** Right-aligned slot in the label row, e.g. a "Forgot password?" link. */
  action?: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
  action,
}: FieldProps) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;

  return (
    <div className={cn('space-y-2', className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={htmlFor} required={required}>
            {label}
          </Label>
          {action}
        </div>
      ) : null}

      <div aria-describedby={describedBy}>{children}</div>

      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p
            key="error"
            id={`${htmlFor}-error`}
            role="alert"
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-start gap-1.5 text-xs font-medium text-destructive"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </motion.p>
        ) : hint ? (
          <p key="hint" id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
