import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

/**
 * Edge middleware: the single gate in front of every page.
 *
 * It only verifies the JWT signature and expiry — it deliberately does not read
 * the JSON store (unavailable in the Edge runtime) or make authorisation
 * decisions beyond the admin/viewer route split. Fine-grained permission checks
 * live in the API handlers, which are the real security boundary; this layer
 * exists so users are redirected before a protected page ever renders.
 */

/** Reachable without a session. A signed-in user is bounced to the dashboard. */
const PUBLIC_PATHS = ['/login', '/forgot-password'];

/**
 * Reachable with or without a session, and never redirected away.
 *
 * These pages authenticate with a one-time token from an email rather than with
 * the session cookie. Someone completing a reset is often still signed in —
 * they hold a valid cookie but have forgotten the password itself, or an admin
 * has just started a reset for them — so bouncing them to the dashboard on the
 * grounds that they have a session would strand them.
 */
const TOKEN_PATHS = ['/reset-password', '/reset-view-password/verify'];

/** Admin-only pages. Viewers hitting these bounce back to the dashboard. */
const ADMIN_PATHS = ['/audit', '/reset-user-password'];

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Checked before anything else: these must work in every session state.
  if (matches(pathname, TOKEN_PATHS)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isPublic = matches(pathname, PUBLIC_PATHS);

  // Signed-in users have no business on the login screen.
  if (session && isPublic) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (isPublic) return NextResponse.next();

  if (!session) {
    const login = new URL('/login', request.url);
    // Remember where they were headed so login can bounce them back.
    if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
    const response = NextResponse.redirect(login);
    // Clear a stale/expired cookie so the browser stops re-sending it.
    if (token) response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (session.role !== 'admin' && matches(pathname, ADMIN_PATHS)) {
    return NextResponse.redirect(new URL('/dashboard?denied=1', request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next internals, static assets and `/api/*`.
   * API routes guard themselves via `withAuth`, which can reach the datastore
   * and therefore make better decisions than this layer can.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
