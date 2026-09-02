/**
 * Shared timings and limits.
 *
 * These live outside the route handlers because Next.js only permits a fixed
 * set of exports from a `route.ts` file — and because the UI needs the same
 * numbers to tell the user how long a code lasts.
 */

/** Lifetime of a login-password reset OTP. */
export const OTP_TTL_MINUTES = 10;

/** Lifetime of an approved reveal-password reset link. */
export const VIEW_RESET_TTL_MINUTES = 30;

/**
 * How long a revealed credential stays on screen before it is hidden again.
 * Short by design: a password left visible is a password on someone's camera.
 */
export const REVEAL_VISIBLE_SECONDS = 10;

/** Page size for the audit log table. */
export const AUDIT_PAGE_SIZE = 25;
