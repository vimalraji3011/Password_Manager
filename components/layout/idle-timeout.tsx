'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { TimerOff } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiFetch } from '@/hooks/use-api';

/**
 * Inactivity watchdog for authenticated pages.
 *
 * The real control is server-side: the session token carries a short idle
 * expiry that only slides forward when the app is actually used, so an
 * abandoned session stops being accepted whether or not this component is
 * mounted. What this adds is the part the server cannot do — clearing the
 * screen on the unattended machine, and warning the user first so a long read
 * of the audit log does not silently cost them their session.
 *
 * Activity is shared across tabs through `localStorage`, because "idle" means
 * idle in the *application*, not in one particular tab. Without that, working
 * in a second tab would let the first tab sign everyone out.
 */

/** Events that count as a person being present. */
const ACTIVITY_EVENTS = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'pointerdown',
] as const;

const STORAGE_KEY = 'opm:last-activity';

/** How long before the deadline the warning dialog appears. */
const WARN_BEFORE_SECONDS = 60;

/** Don't hammer localStorage on every mouse event. */
const WRITE_THROTTLE_MS = 5_000;

function readSharedActivity(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // Private mode, or storage disabled. Fall back to this tab's own clock.
    return 0;
  }
}

export function IdleTimeout({ idleSeconds }: { idleSeconds: number }) {
  const router = useRouter();

  const [remaining, setRemaining] = React.useState<number | null>(null);
  const lastActivity = React.useRef(Date.now());
  const lastWrite = React.useRef(0);
  const signingOut = React.useRef(false);

  // Warn with a minute to go — but never before half the window has elapsed,
  // so a deliberately short timeout doesn't warn the instant the page loads.
  const warnAfterSeconds = Math.max(
    Math.floor(idleSeconds / 2),
    idleSeconds - WARN_BEFORE_SECONDS,
  );

  const markActive = React.useCallback((broadcast: boolean) => {
    const now = Date.now();
    lastActivity.current = now;

    if (broadcast && now - lastWrite.current > WRITE_THROTTLE_MS) {
      lastWrite.current = now;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(now));
      } catch {
        // Nothing to do; this tab still tracks its own activity.
      }
    }
  }, []);

  const signOut = React.useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;

    try {
      // Best effort: the cookie may already have expired, in which case the
      // request 401s and the redirect below is what matters.
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignored on purpose — we are leaving either way.
    }

    window.location.href = '/login?timeout=1';
  }, []);

  // Track activity in this tab, and pick up activity from the others.
  React.useEffect(() => {
    const onActivity = () => markActive(true);

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    const onStorage = (event: StorageEvent) => {
      // Another tab reported activity; adopt its timestamp without echoing it
      // back, which would otherwise bounce between tabs indefinitely.
      if (event.key === STORAGE_KEY && event.newValue) {
        const stamp = Number(event.newValue);
        if (Number.isFinite(stamp)) lastActivity.current = Math.max(lastActivity.current, stamp);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      window.removeEventListener('storage', onStorage);
    };
  }, [markActive]);

  // The clock. One interval, checked once a second.
  React.useEffect(() => {
    const tick = () => {
      // A tab that was asleep may have missed `storage` events entirely, so
      // re-read the shared value rather than trusting this tab's own ref.
      const reference = Math.max(lastActivity.current, readSharedActivity());
      const idleFor = Math.floor((Date.now() - reference) / 1000);

      if (idleFor >= idleSeconds) {
        void signOut();
        return;
      }

      setRemaining(idleFor >= warnAfterSeconds ? idleSeconds - idleFor : null);
    };

    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [idleSeconds, warnAfterSeconds, signOut]);

  async function staySignedIn() {
    markActive(true);
    setRemaining(null);

    /**
     * Touch the server so the cookie's idle window slides forward too.
     *
     * Dismissing the dialog only resets the *client* clock; without this call
     * the token would still expire on schedule and the next action would fail
     * with a redirect to login — exactly what the user just asked to avoid.
     */
    try {
      await apiFetch('/api/auth/me');
      router.refresh();
    } catch {
      // Session already gone. The next tick will notice and sign out cleanly.
    }
  }

  return (
    <AlertDialog open={remaining !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-warning/12 text-warning sm:mx-0">
            <TimerOff className="size-5" />
          </div>
          <AlertDialogTitle>Still there?</AlertDialogTitle>
          <AlertDialogDescription>
            You will be signed out in{' '}
            <span className="font-semibold tabular-nums text-foreground">{remaining ?? 0}</span>{' '}
            second{remaining === 1 ? '' : 's'} because of inactivity. Anything you have open will
            be closed.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={(event) => {
              event.preventDefault();
              void signOut();
            }}
          >
            Sign out now
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void staySignedIn();
            }}
          >
            Stay signed in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
