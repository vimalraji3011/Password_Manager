import 'server-only';
import { hashToken, safeCompare } from '@/lib/crypto';
import { resetRequests } from '@/lib/repository';
import type { ResetRequest, ResetRequestKind } from '@/types';

/**
 * Shared verification for both reset flows (OTP-based login reset, and the
 * admin-approved reveal-password reset).
 *
 * Both flows need exactly the same checks — pending, unexpired, attempt budget
 * not blown, constant-time token comparison — so they live here rather than
 * being reimplemented in three route handlers.
 */

/** Verifying an OTP is cheap for us and cheap for a brute-forcer; cap it. */
const MAX_ATTEMPTS = 5;

export type ResetFailure =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'INVALID';

export type ResetVerification =
  | { valid: true; request: ResetRequest }
  | { valid: false; reason: ResetFailure };

/** Human-facing copy for each failure. Vague on purpose where it needs to be. */
export const RESET_FAILURE_MESSAGE: Record<ResetFailure, string> = {
  NOT_FOUND: 'This reset request is no longer valid. Start again.',
  EXPIRED: 'This code has expired. Request a new one.',
  TOO_MANY_ATTEMPTS: 'Too many incorrect attempts. Request a new code.',
  INVALID: 'That code is not correct.',
};

/**
 * Check a token/OTP against the newest pending request for a user.
 *
 * `consume: false` lets the UI validate a code before showing the
 * new-password step without burning it.
 */
export async function verifyResetToken(options: {
  kind: ResetRequestKind;
  userId: number;
  token: string;
  consume: boolean;
}): Promise<ResetVerification> {
  const candidates = await resetRequests.filter(
    (item) =>
      item.userId === options.userId &&
      item.kind === options.kind &&
      (item.status === 'PENDING' || item.status === 'APPROVED'),
  );

  // Newest first: an older code must never win over the one just emailed.
  candidates.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const request = candidates[0];

  if (!request || !request.tokenHash) return { valid: false, reason: 'NOT_FOUND' };

  if (request.expiresAt && new Date(request.expiresAt).getTime() < Date.now()) {
    await resetRequests.update(request.id, { status: 'EXPIRED' });
    return { valid: false, reason: 'EXPIRED' };
  }

  if (request.attempts >= MAX_ATTEMPTS) {
    await resetRequests.update(request.id, { status: 'EXPIRED' });
    return { valid: false, reason: 'TOO_MANY_ATTEMPTS' };
  }

  if (!safeCompare(hashToken(options.token), request.tokenHash)) {
    await resetRequests.update(request.id, { attempts: request.attempts + 1 });
    return { valid: false, reason: 'INVALID' };
  }

  if (options.consume) {
    // Clearing tokenHash is what makes the code genuinely single-use.
    await resetRequests.update(request.id, {
      status: 'COMPLETED',
      tokenHash: null,
      completedAt: new Date().toISOString(),
    });
  }

  return { valid: true, request };
}

/** Find a pending/approved request by its one-time token, across all users. */
export async function findRequestByToken(
  kind: ResetRequestKind,
  token: string,
): Promise<ResetRequest | null> {
  const hash = hashToken(token);
  const all = await resetRequests.all();

  const match = all.find(
    (item) =>
      item.kind === kind &&
      item.tokenHash != null &&
      safeCompare(hash, item.tokenHash) &&
      (item.status === 'PENDING' || item.status === 'APPROVED'),
  );

  if (!match) return null;
  if (match.expiresAt && new Date(match.expiresAt).getTime() < Date.now()) {
    await resetRequests.update(match.id, { status: 'EXPIRED' });
    return null;
  }
  return match;
}
