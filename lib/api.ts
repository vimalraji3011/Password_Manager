import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
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

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return (
    request.headers.get('x-real-ip') ?? request.headers.get('cf-connecting-ip') ?? '127.0.0.1'
  );
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

      return await handler({ request, user });
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

      return await handler({ request, user, params: await ctx.params });
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
