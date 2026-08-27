import 'server-only';

/**
 * In-memory sliding-window rate limiter.
 *
 * Deliberately process-local: this app has no database and runs as a single
 * Node process, so a Map is the right amount of machinery. If the app is ever
 * scaled horizontally this must move to Redis — the interface below is the only
 * thing callers depend on, so that swap stays local to this file.
 */

interface Window {
  hits: number[];
  blockedUntil?: number;
}

const buckets = new Map<string, Window>();

/** Drop stale buckets so a long-running process cannot leak memory. */
function sweep(now: number) {
  if (buckets.size < 512) return;
  for (const [key, window] of buckets) {
    const fresh = window.hits.some((t) => now - t < 3_600_000);
    if (!fresh && (!window.blockedUntil || window.blockedUntil < now)) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Unique bucket key, e.g. `login:<ip>`. */
  key: string;
  /** Requests allowed inside the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** How long to lock the bucket once the limit is exceeded. */
  blockMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds the caller must wait. Only meaningful when `allowed` is false. */
  retryAfter: number;
}

export function rateLimit({
  key,
  limit,
  windowMs,
  blockMs = windowMs,
}: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const window = buckets.get(key) ?? { hits: [] };

  if (window.blockedUntil && window.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((window.blockedUntil - now) / 1000),
    };
  }

  window.hits = window.hits.filter((t) => now - t < windowMs);

  if (window.hits.length >= limit) {
    window.blockedUntil = now + blockMs;
    buckets.set(key, window);
    return { allowed: false, remaining: 0, retryAfter: Math.ceil(blockMs / 1000) };
  }

  window.hits.push(now);
  delete window.blockedUntil;
  buckets.set(key, window);

  return { allowed: true, remaining: limit - window.hits.length, retryAfter: 0 };
}

/** Clear a bucket after a successful attempt so honest users are never locked out. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Tuned limits for the sensitive endpoints. */
export const LIMITS = {
  login: { limit: 5, windowMs: 5 * 60_000, blockMs: 10 * 60_000 },
  otpRequest: { limit: 3, windowMs: 10 * 60_000, blockMs: 10 * 60_000 },
  otpVerify: { limit: 6, windowMs: 10 * 60_000, blockMs: 10 * 60_000 },
  reveal: { limit: 10, windowMs: 5 * 60_000, blockMs: 5 * 60_000 },
} as const;
