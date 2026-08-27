'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shown when a System Admin has started a reset for this account.
 *
 * The old password deliberately keeps working — locking someone out
 * mid-workflow would be worse than the risk being mitigated — so this banner is
 * the reminder that a code is waiting in their inbox.
 */
export function MustChangePasswordBanner({ email }: { email: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      role="status"
      className="mb-5 flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/8 p-4 sm:flex-row sm:items-center"
    >
      <ShieldAlert className="size-5 shrink-0 text-warning" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">A password reset is pending for your account</p>
        <p className="text-sm text-muted-foreground">
          A System Admin emailed a single-use code to {email}. Your current password still works
          until you complete the reset.
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/profile">
            <KeyRound />
            Change here instead
          </Link>
        </Button>
        <Button variant="default" size="sm" asChild>
          <Link href={`/reset-password?email=${encodeURIComponent(email)}`}>Use the code</Link>
        </Button>
      </div>
    </motion.div>
  );
}
