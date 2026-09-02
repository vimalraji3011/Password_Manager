import 'server-only';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { Collection, FILES } from '@/lib/json-storage';
import {
  SESSION_COOKIE,
  getExpirySeconds,
  getIdleTimeoutSeconds,
  refreshSessionToken,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from '@/lib/session';
import type { Role, SafeUser, SessionPayload, User } from '@/types';

/**
 * Server-side authentication helpers.
 *
 * Split from `lib/session.ts` on purpose: session token verification must run
 * in the Edge runtime (middleware), while bcrypt and the JSON store are
 * Node-only. Keeping them apart stops Next.js from trying to bundle bcrypt
 * into the Edge middleware.
 */

const BCRYPT_ROUNDS = 12;

export const users = new Collection<User>(FILES.users);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const normalised = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === normalised);
}

/** Read + verify the session cookie. Returns null when absent or invalid. */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Resolve the session all the way to the stored user record, so a deleted or
 * role-changed user can't keep acting on a stale token.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await users.byId(session.sub);
  return user ?? null;
}

export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === 'admin';
}

/** Issue the session cookie after a successful credential check. */
export async function createSession(user: User): Promise<void> {
  const token = await signSessionToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    // The absolute deadline is set once, here, and survives every refresh.
    abs: Math.floor(Date.now() / 1000) + getExpirySeconds(),
  });

  const jar = await cookies();
  // Cookie lifetime tracks the *idle* window, so a browser left open overnight
  // discards the cookie by itself rather than presenting a dead token.
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(getIdleTimeoutSeconds()));
}

/**
 * Slide the idle window forward for an active user.
 *
 * Called from the API wrapper on every authenticated request. A no-op when the
 * token is fresh, already pinned to the absolute deadline, or invalid — so it
 * can never resurrect a session that should have ended.
 */
export async function refreshSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;

  const renewed = await refreshSessionToken(token);
  if (!renewed) return;

  jar.set(SESSION_COOKIE, renewed, sessionCookieOptions(getIdleTimeoutSeconds()));
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  // Overwrite before deleting: some proxies drop a bare `Max-Age=0` delete, and
  // a half-cleared session cookie is worse than none.
  jar.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  jar.delete(SESSION_COOKIE);
}

/** Capability matrix. Kept in one place so UI and API can't drift apart. */
export const PERMISSIONS = {
  admin: [
    'organization:create',
    'organization:update',
    'organization:delete',
    'source:create',
    'source:update',
    'source:delete',
    'source:reveal',
    'user:reset-password',
    'reset:approve',
    'audit:view',
  ],
  viewer: ['organization:read', 'source:read'],
} as const;

export type Permission = (typeof PERMISSIONS)['admin'][number] | (typeof PERMISSIONS)['viewer'][number];

export function can(role: Role, permission: Permission): boolean {
  if (role === 'admin') return true; // admin has full access by definition
  return (PERMISSIONS.viewer as readonly string[]).includes(permission);
}
