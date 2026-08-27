import { SignJWT, jwtVerify } from 'jose';
import type { SessionPayload } from '@/types';

/**
 * JWT session tokens, signed with HS256 via `jose`.
 *
 * `jose` (rather than `jsonwebtoken`) because this module is imported by
 * `middleware.ts`, which runs in the Edge runtime where Node's `crypto` module
 * is unavailable. Tokens live in an HTTP-only cookie so client-side JS — and
 * therefore any XSS payload — cannot read them.
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

export function getExpirySeconds(): number {
  const parsed = Number(process.env.JWT_EXPIRY_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 28_800; // 8 hours
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: payload.email, name: payload.name, role: payload.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(payload.sub))
    .setIssuedAt(now)
    .setExpirationTime(now + getExpirySeconds())
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
    return {
      sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: payload.role === 'admin' ? 'admin' : 'viewer',
    };
  } catch {
    // Expired, tampered, or wrong secret — all mean "not authenticated".
    return null;
  }
}
