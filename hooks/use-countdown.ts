'use client';

import * as React from 'react';

/**
 * Counts down from `seconds` to zero, once per second.
 *
 * Drives the auto-hide timer on the reveal-password modal and the OTP resend
 * cooldown. `reset()` restarts it; `stop()` cancels it (used when the modal is
 * closed early so the interval does not outlive the component).
 */
export function useCountdown(seconds: number, options?: { onComplete?: () => void }) {
  const [remaining, setRemaining] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const onComplete = React.useRef(options?.onComplete);
  onComplete.current = options?.onComplete;

  React.useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          clearInterval(interval);
          setRunning(false);
          onComplete.current?.();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [running]);

  const start = React.useCallback(
    (from = seconds) => {
      setRemaining(from);
      setRunning(true);
    },
    [seconds],
  );

  const stop = React.useCallback(() => {
    setRunning(false);
    setRemaining(0);
  }, []);

  return { remaining, running, start, stop };
}
