'use client';

import * as React from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, type InputProps } from '@/components/ui/input';
import { passwordStrength } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * Password field with a show/hide toggle and an optional strength meter.
 *
 * The toggle only affects the local `type` attribute — it never sends the value
 * anywhere, and the field is `autoComplete`-aware so browsers do the right
 * thing on login vs. new-password screens.
 */
export interface PasswordInputProps extends Omit<InputProps, 'type' | 'trailing'> {
  /** Render the 4-segment strength meter under the field. */
  showStrength?: boolean;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ showStrength = false, value, icon, className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    const strength = showStrength ? passwordStrength(String(value ?? '')) : null;

    return (
      <div className="space-y-2">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          value={value}
          icon={icon ?? <Lock />}
          className={cn('pr-11', className)}
          trailing={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mr-1 text-muted-foreground hover:text-foreground"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'Hide password' : 'Show password'}
              aria-pressed={visible}
              tabIndex={-1}
            >
              {visible ? <EyeOff /> : <Eye />}
            </Button>
          }
          {...props}
        />

        {strength && String(value ?? '').length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex flex-1 gap-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors duration-300',
                    i < strength.score
                      ? strength.score <= 1
                        ? 'bg-destructive'
                        : strength.score === 2
                          ? 'bg-warning'
                          : 'bg-success'
                      : 'bg-muted',
                  )}
                />
              ))}
            </div>
            <span className="w-20 shrink-0 text-right text-xs font-medium text-muted-foreground">
              {strength.label}
            </span>
          </div>
        ) : null}
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
