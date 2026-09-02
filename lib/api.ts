import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, refreshSession } from '@/lib/auth';
import type { ApiResponse, Role, User } from '@/types';

/**
 * Shared plumbing for API routes: uniform responses, auth guards, CSRF checks
 * and client-IP extraction. Route handlers stay thin because everything
 * cross-cutting lives here.
 */

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function fail(
  error: string,
  status = 400,
  fields?: Record<string, string>,
): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ ok: false, error, ...(fields ? { fields } : {}) }, { status });
}

export const unauthorized = () => fail('You are not signed in.', 401);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  fail(message, 403);
export const notFound = (what = 'Resource') => fail(`${what} not found.`, 404);

/** Never leak internals to the client; log the detail server-side instead. */
export function serverError(error: unknown): NextResponse<ApiResponse<never>> {
  console.error('[api]', error);
  const message =
    error instanceof Error && /MASTER_ENCRYPTION_KEY|JWT_SECRET/.test(error.message)
      ? error.message // configuration errors are safe and actionable
      : 'Something went wrong. Please try again.';
  return fail(message, 500);
}

/**
 * Stamp a response as uncacheable.
 *
 * Applied to every authenticated API response, not just the reveal endpoint.
 * Organization lists, usernames and audit trails are all sensitive enough that
 * a shared corporate proxy — or the browser's own back/forward cache on a
 * kiosk machine — should never hold a copy after sign-out.
 */
export function noStore<T extends NextResponse>(response: T): T {
  response.headers.set('cache-control', 'no-store, no-cache, must-revalidate, private');
  response.headers.set('pragma', 'no-cache');
  response.headers.set('expires', '0');
  return response;
}

/**
 * Best-effort client IP, used for rate-limit keys and the audit trail.
 *
 * `x-forwarded-for` is just a request header: anyone can send one. Trusting it
 * unconditionally would hand an attacker a fresh rate-limit bucket per request
 * — `login:ip:1.2.3.4`, `login:ip:1.2.3.5`, … — which quietly turns "5 attempts
 * per 5 minutes" into no limit at all.
 *
 * So the forwarded headers are only honoured when `TRUST_PROXY=true` says this
 * app really is behind a reverse proxy that overwrites them (nginx, Cloudflare,
 * Vercel). Otherwise the socket address is used, and when even that is
 * unavailable every caller collapses into one shared bucket — throttling too
 * much rather than too little.
 */
export function clientIp(request: NextRequest): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for');
    // Left-most entry is the original client; the rest are proxy hops.
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    const direct = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip');
    if (direct) return direct.trim();
  }

  return UNKNOWN_IP;
}

/**
 * Sentinel for "no IP we are willing to believe".
 *
 * Next 15 removed `NextRequest.ip`, so without a trusted proxy there is no
 * socket address available to a route handler at all — the only candidate is a
 * header the caller wrote themselves.
 */
export const UNKNOWN_IP = 'unknown';

/**
 * Whether an IP is trustworthy enough to rate-limit on.
 *
 * Callers skip their per-IP bucket when this is false. That is deliberate: a
 * bucket keyed on a spoofable header is not a limit, and collapsing every
 * caller into one shared `unknown` bucket would be worse still — a single
 * attacker could exhaust it and lock the whole office out of the vault. The
 * per-account buckets, which key on something the attacker cannot rotate,
 * remain in force either way.
 */
export function hasReliableIp(ip: string): boolean {
  return ip !== UNKNOWN_IP;
}

export function userAgent(request: NextRequest): string {
  return request.headers.get('user-agent') ?? 'unknown';
}

/**
 * CSRF defence for cookie-authenticated mutations.
 *
 * SameSite=Lax already blocks cross-site form POSTs, but it is not a complete
 * defence on its own, so state-changing requests must additionally carry
 * `x-requested-with` (a header a cross-origin HTML form cannot set) and, when
 * present, an Origin that matches the Host.
 */
export function verifyCsrf(request: NextRequest): string | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;

  if (request.headers.get('x-requested-with') !== 'opm-app') {
    return 'Request blocked: missing CSRF header.';
  }

  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('host');
    try {
      if (new URL(origin).host !== host) return 'Request blocked: origin mismatch.';
    } catch {
      return 'Request blocked: malformed origin.';
    }
  }
  return null;
}

type Handler<T> = (context: { request: NextRequest; user: User }) => Promise<NextResponse<T>>;

/**
 * Wrap a route handler so it only runs for an authenticated user (optionally
 * of a given role), with CSRF verified and errors normalised.
 */
export function withAuth<T>(handler: Handler<ApiResponse<T>>, options?: { role?: Role }) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return fail(csrfError, 403);

      const user = await getCurrentUser();
      if (!user) return unauthorized();
      if (options?.role && user.role !== options.role) return forbidden();

      // Real activity, so push the inactivity window forward.
      await refreshSession();

      return noStore(await handler({ request, user }));
    } catch (error) {
      return serverError(error);
    }
  };
}

/** Same as `withAuth`, for routes that also need dynamic route params. */
export function withAuthParams<T, P extends Record<string, string>>(
  handler: (context: {
    request: NextRequest;
    user: User;
    params: P;
  }) => Promise<NextResponse<ApiResponse<T>>>,
  options?: { role?: Role },
) {
  return async (request: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return fail(csrfError, 403);

      const user = await getCurrentUser();
      if (!user) return unauthorized();
      if (options?.role && user.role !== options.role) return forbidden();

      await refreshSession();

      return noStore(await handler({ request, user, params: await ctx.params }));
    } catch (error) {
      return serverError(error);
    }
  };
}

/** For public routes (login, forgot-password): CSRF + error handling only. */
export function withPublic(handler: (request: NextRequest) => Promise<NextResponse>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return fail(csrfError, 403);
      return await handler(request);
    } catch (error) {
      return serverError(error);
    }
  };
}

/** Parse a JSON body, tolerating an empty one. */
export async function readBody<T = Record<string, unknown>>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export function parseId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
