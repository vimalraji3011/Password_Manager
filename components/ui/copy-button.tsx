'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { toast } from 'sonner';

/**
 * Copy-to-clipboard button.
 *
 * `navigator.clipboard` is unavailable on insecure origins, so this falls back
 * to the legacy `execCommand` path — an internal tool is often served over
 * plain HTTP on a LAN address.
 */
export function CopyButton({
  value,
  label = 'Copy',
  successMessage = 'Copied to clipboard',
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: {
  value: string;
  label?: string;
  successMessage?: string;
} & Omit<ButtonProps, 'value' | 'onClick' | 'children'>) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      toast.success(successMessage);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not access the clipboard. Copy the value manually.');
    }
  }

  return (
    <Hint label={copied ? 'Copied' : label}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={copy}
        aria-label={label}
        {...props}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </Hint>
  );
}
