import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  getIdleTimeoutSeconds,
  refreshSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from '@/lib/session';

/**
 * Edge middleware: the single gate in front of every page.
 *
 * Three jobs, in this order:
 *
 *  1. **Security headers**, including a per-request nonce-based CSP. Applied to
 *     every response, public pages included — the login form is exactly where an
 *     injected script would be most valuable.
 *  2. **Routing by session state** — verifying only the JWT signature, expiry
 *     and role. It deliberately does not read the JSON store (unavailable in the
 *     Edge runtime); fine-grained permission checks live in the API handlers,
 *     which are the real security boundary. This layer exists so users are
 *     redirected before a protected page ever renders.
 *  3. **Sliding the idle window** for an active user, so browsing the app counts
 *     as activity just as API calls do.
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

/**
 * Content-Security-Policy for this request.
 *
 * Script execution is gated on a fresh random nonce, which Next.js copies onto
 * its own inline bootstrap scripts; strict-dynamic then lets those load the
 * app's chunks without the policy having to enumerate them. An injected script
 * tag carries no nonce and simply does not run — the mitigation that matters
 * most for a page that puts a decrypted password on screen.
 *
 * style-src keeps 'unsafe-inline': Tailwind's runtime-injected styles and
 * framer-motion's animated style attributes both need it, and inline CSS is a
 * far weaker vector than inline JS.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== 'production';

  return [
    "default-src 'self'",
    // unsafe-eval only in dev, where the HMR runtime requires it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Fonts are self-hosted by next/font, so no third-party origin is needed.
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    // Same-origin API only; websockets in dev for hot reload.
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    // The app never posts anywhere but itself — blocks exfiltration by form.
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "manifest-src 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

function applySecurityHeaders(response: NextResponse, nonce: string, authenticated: boolean) {
  response.headers.set('content-security-policy', contentSecurityPolicy(nonce));
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  response.headers.set('cross-origin-opener-policy', 'same-origin');
  response.headers.set('cross-origin-resource-policy', 'same-origin');

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'strict-transport-security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  if (authenticated) {
    /**
     * No caching of authenticated pages, anywhere.
     *
     * Without this, hitting Back after signing out can re-render the vault from
     * the browser's history cache — organization names, usernames and audit
     * entries included. On a shared machine that is a real leak.
     */
    response.headers.set('cache-control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('pragma', 'no-cache');
    response.headers.set('expires', '0');
  }

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 128 bits of randomness, regenerated for every single request.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

  /**
   * Forward the nonce to the render pass.
   *
   * Next.js reads x-nonce off the request to stamp its own script tags, and the
   * root layout reads it to pass along to the one third-party inline script the
   * app mounts (the next-themes anti-flash snippet).
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  const forward = { request: { headers: requestHeaders } };

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  // Checked before the routing rules: these must work in every session state.
  if (matches(pathname, TOKEN_PATHS)) {
    return applySecurityHeaders(NextResponse.next(forward), nonce, false);
  }

  const isPublic = matches(pathname, PUBLIC_PATHS);

  // Signed-in users have no business on the login screen.
  if (session && isPublic) {
    return applySecurityHeaders(
      NextResponse.redirect(new URL('/dashboard', request.url)),
      nonce,
      true,
    );
  }

  if (isPublic) {
    return applySecurityHeaders(NextResponse.next(forward), nonce, false);
  }

  if (!session) {
    const login = new URL('/login', request.url);
    // Remember where they were headed so login can bounce them back.
    if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
    const response = NextResponse.redirect(login);
    // Clear the stale / idle-expired cookie so the browser stops re-sending it.
    if (token) response.cookies.delete(SESSION_COOKIE);
    return applySecurityHeaders(response, nonce, false);
  }

  if (session.role !== 'admin' && matches(pathname, ADMIN_PATHS)) {
    return applySecurityHeaders(
      NextResponse.redirect(new URL('/dashboard?denied=1', request.url)),
      nonce,
      true,
    );
  }

  const response = NextResponse.next(forward);

  // Navigating the app is activity: push the inactivity deadline forward. A
  // no-op unless the token is over a minute old, so this is not a Set-Cookie on
  // every navigation.
  if (token) {
    const renewed = await refreshSessionToken(token);
    if (renewed) {
      response.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions(getIdleTimeoutSeconds()));
    }
  }

  return applySecurityHeaders(response, nonce, true);
}

export const config = {
  /**
   * Everything except Next internals, static assets and /api/*.
   * API routes guard themselves via withAuth, which can reach the datastore and
   * therefore make better decisions than this layer can.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
