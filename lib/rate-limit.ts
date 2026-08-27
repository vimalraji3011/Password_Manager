import 'server-only';
import { FILES, updateJson } from '@/lib/json-storage';
import { getStorageDriver } from '@/lib/storage';

/**
 * Sliding-window rate limiter with two backends.
 *
 * **In-memory** when the filesystem driver is active: a single Node process owns
 * all traffic, so a Map is exactly the right amount of machinery.
 *
 * **Shared, via the datastore** when the Postgres driver is active. This matters
 * more than it looks: on a serverless host each instance would otherwise keep
 * its own counters, so "5 login attempts per 5 minutes" silently becomes 5 *per
 * instance* — and an attacker who reconnects enough times gets as many attempts
 * as they like. A rate limit that scales with the attacker's patience is not a
 * rate limit, so it moves into shared storage where the driver is distributed.
 *
 * Write volume is trivial (a handful of rows on failed auth attempts), and the
 * successful path clears the bucket, so honest users cost nothing.
 */

interface Window {
  hits: number[];
  blockedUntil?: number;
}

type Buckets = Record<string, Window>;

const memory = new Map<string, Window>();

/** Drop stale buckets so a long-running process cannot leak memory. */
function sweepMemory(now: number) {
  if (memory.size < 512) return;
  for (const [key, window] of memory) {
    const fresh = window.hits.some((t) => now - t < 3_600_000);
    if (!fresh && (!window.blockedUntil || window.blockedUntil < now)) memory.delete(key);
  }
}

/** Same pruning for the shared document, which has no process to bound it. */
function sweepShared(buckets: Buckets, now: number): Buckets {
  const kept: Buckets = {};
  for (const [key, window] of Object.entries(buckets)) {
    const fresh = window.hits.some((t) => now - t < 3_600_000);
    if (fresh || (window.blockedUntil && window.blockedUntil > now)) kept[key] = window;
  }
  return kept;
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

/**
 * Pure decision function, shared by both backends so they cannot drift apart.
 * Returns the verdict plus the window to persist.
 */
function evaluate(
  window: Window | undefined,
  now: number,
  { limit, windowMs, blockMs }: Required<Omit<RateLimitOptions, 'key'>>,
): { result: RateLimitResult; next: Window | null } {
  const current: Window = window ?? { hits: [] };

  if (current.blockedUntil && current.blockedUntil > now) {
    return {
      result: {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((current.blockedUntil - now) / 1000),
      },
      // Nothing to write: the block is already recorded.
      next: null,
    };
  }

  const hits = current.hits.filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    return {
      result: { allowed: false, remaining: 0, retryAfter: Math.ceil(blockMs / 1000) },
      next: { hits, blockedUntil: now + blockMs },
    };
  }

  return {
    result: { allowed: true, remaining: limit - hits.length - 1, retryAfter: 0 },
    next: { hits: [...hits, now] },
  };
}

export async function rateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowMs, blockMs = windowMs } = options;
  const now = Date.now();
  const config = { limit, windowMs, blockMs };

  if (getStorageDriver().name === 'filesystem') {
    sweepMemory(now);
    const { result, next } = evaluate(memory.get(key), now, config);
    if (next) memory.set(key, next);
    return result;
  }

  // Shared path. The mutator is pure, so the driver may safely retry it.
  return updateJson<Buckets, RateLimitResult>(
    FILES.rateLimits,
    {},
    (buckets) => evaluate(buckets[key], now, config).result,
    (buckets, _result) => {
      const { next } = evaluate(buckets[key], now, config);
      const pruned = sweepShared(buckets, now);
      return next ? { ...pruned, [key]: next } : pruned;
    },
  );
}

/** Clear a bucket after a successful attempt so honest users are never locked out. */
export async function resetRateLimit(key: string): Promise<void> {
  if (getStorageDriver().name === 'filesystem') {
    memory.delete(key);
    return;
  }

  await updateJson<Buckets, void>(
    FILES.rateLimits,
    {},
    () => undefined,
    (buckets) => {
      if (!(key in buckets)) return buckets;
      const { [key]: _removed, ...rest } = buckets;
      return rest;
    },
  );
}

/** Tuned limits for the sensitive endpoints. */
export const LIMITS = {
  login: { limit: 5, windowMs: 5 * 60_000, blockMs: 10 * 60_000 },
  otpRequest: { limit: 3, windowMs: 10 * 60_000, blockMs: 10 * 60_000 },
  otpVerify: { limit: 6, windowMs: 10 * 60_000, blockMs: 10 * 60_000 },
  reveal: { limit: 10, windowMs: 5 * 60_000, blockMs: 5 * 60_000 },
} as const;
