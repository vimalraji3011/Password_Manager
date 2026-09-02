import { SignJWT, jwtVerify } from 'jose';
import type { SessionPayload } from '@/types';

/**
 * JWT session tokens, signed with HS256 via `jose`.
 *
 * `jose` (rather than `jsonwebtoken`) because this module is imported by
 * `middleware.ts`, which runs in the Edge runtime where Node's `crypto` module
 * is unavailable. Tokens live in an HTTP-only cookie so client-side JS — and
 * therefore any XSS payload — cannot read them.
 *
 * ## Two clocks
 *
 * A vault should log you out when you walk away, but it should also stop
 * trusting a session eventually no matter how busy you look. So a token carries
 * two deadlines:
 *
 *  - **`exp` — the idle deadline.** Short (30 minutes by default) and pushed
 *    forward every time the session is used. Walk away from an unlocked laptop
 *    and the session dies on its own.
 *  - **`abs` — the absolute deadline.** Fixed at sign-in and copied unchanged
 *    into every refreshed token. Sliding can never push past it, so a stolen
 *    cookie cannot be kept alive indefinitely by polling.
 *
 * Both are enforced server-side. The client-side idle watcher is a courtesy
 * that clears the screen promptly; it is not the control.
 */

export const SESSION_COOKIE = 'opm_session';

const encoder = new TextEncoder();

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 characters. Run `npm run genkey`.',
    );
  }
  return encoder.encode(secret);
}

/** Absolute lifetime of a session, from sign-in. Default 8 hours. */
export function getExpirySeconds(): number {
  const parsed = Number(process.env.JWT_EXPIRY_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 28_800;
}

/** Inactivity window. Default 30 minutes, and never longer than the absolute cap. */
export function getIdleTimeoutSeconds(): number {
  const parsed = Number(process.env.SESSION_IDLE_TIMEOUT_SECONDS);
  const idle = Number.isFinite(parsed) && parsed > 0 ? parsed : 1_800;
  return Math.min(idle, getExpirySeconds());
}

/**
 * How stale a token must be before a refresh rewrites the cookie.
 *
 * Re-signing on literally every request would mean a `Set-Cookie` on every API
 * call for no security gain, so the idle window only advances once a minute.
 */
const REFRESH_AFTER_SECONDS = 60;

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // Never let the sliding window outlive the absolute deadline.
  const exp = Math.min(now + getIdleTimeoutSeconds(), payload.abs);

  return new SignJWT({
    email: payload.email,
    name: payload.name,
    role: payload.role,
    abs: payload.abs,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(payload.sub))
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer('office-password-manager')
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: 'office-password-manager',
      algorithms: ['HS256'],
    });

    const sub = Number(payload.sub);
    if (!Number.isFinite(sub)) return null;

    const abs = Number(payload.abs);
    // A token with no usable absolute deadline predates this scheme (or was
    // hand-crafted). Treat it as expired rather than trusting it forever.
    if (!Number.isFinite(abs)) return null;
    if (abs <= Math.floor(Date.now() / 1000)) return null;

    return {
      sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: payload.role === 'admin' ? 'admin' : 'viewer',
      abs,
    };
  } catch {
    // Expired (idle timeout), tampered, or wrong secret — all mean
    // "not authenticated".
    return null;
  }
}

/**
 * Decide whether a still-valid session is due a refreshed cookie.
 *
 * Returns the new token, or null when the current one is fresh enough to leave
 * alone. Split out so middleware (Edge) and the API wrapper (Node) apply the
 * same rule.
 */
export async function refreshSessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: 'office-password-manager',
      algorithms: ['HS256'],
    });

    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(payload.iat ?? 0);
    if (now - issuedAt < REFRESH_AFTER_SECONDS) return null;

    const session = await verifySessionToken(token);
    if (!session) return null;

    // Already pinned to the absolute deadline: re-signing would change nothing.
    if (Number(payload.exp ?? 0) >= session.abs) return null;

    return await signSessionToken(session);
  } catch {
    return null;
  }
}

/** Cookie attributes, defined once so every writer of the cookie agrees. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    /**
     * `strict`, not `lax`.
     *
     * Lax still sends the cookie on top-level cross-site GETs, which is enough
     * for an attacker's page to navigate a victim into an authenticated view.
     * For a credential vault that is not a trade worth making. The cost is that
     * following a link from an email lands you signed-out on the first hop —
     * acceptable, because the pages reached that way (`/reset-password`,
     * `/reset-view-password/verify`) authenticate with their own one-time token
     * and never needed the cookie.
     */
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
