/**
 * Domain model for Office Password Management.
 *
 * Every entity is persisted as JSON under `data/`. Ids are numeric and
 * monotonically increasing per collection so a future SQL migration can map
 * them straight onto auto-increment primary keys.
 */

import type { PasswordKdf } from '@/lib/password-kdf';

export type Role = 'admin' | 'viewer';

/**
 * Login identity.
 *
 * `passwordHash` is bcrypt and never reversible. What it is bcrypt *of* depends
 * on `passwordKdf`: for a migrated account it is the PBKDF2 proof the browser
 * derived, for a legacy one it is the password itself.
 */
export interface User {
  id: number;
  name: string;
  email: string;
  mobile: string;
  passwordHash: string;
  /**
   * Which credential the browser sends for this account.
   *
   * Absent means legacy — the account predates client-side derivation and still
   * expects a plaintext password, until its owner next signs in and is upgraded
   * in place.
   */
  passwordKdf?: PasswordKdf;
  role: Role;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set when an admin forces a reset; user must change password at next login. */
  mustChangePassword?: boolean;
}

/** User shape safe to send to the browser. */
export type SafeUser = Omit<User, 'passwordHash'>;

/**
 * An AES-256-GCM ciphertext envelope. Stored instead of a hash because vault
 * credentials must remain readable by authorised users.
 */
export interface EncryptedValue {
  /** Envelope version, so key rotation / algorithm changes stay decryptable. */
  v: 1;
  /** Initialisation vector, base64. */
  iv: string;
  /** Auth tag, base64. */
  tag: string;
  /** Ciphertext, base64. */
  data: string;
}

/** A single credential inside an organization. */
export interface Source {
  id: number;
  organizationId: number;
  source: string;
  username: string;
  password: EncryptedValue;
  url: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** Source shape sent to the browser — ciphertext is never exposed. */
export type SafeSource = Omit<Source, 'password'> & { hasPassword: boolean };

export interface Organization {
  id: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type OrganizationWithCount = Organization & { sourceCount: number };

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_VIEWED'
  | 'PASSWORD_UPDATED'
  | 'SOURCE_CREATED'
  | 'SOURCE_UPDATED'
  | 'SOURCE_DELETED'
  | 'ORGANIZATION_CREATED'
  | 'ORGANIZATION_UPDATED'
  | 'ORGANIZATION_DELETED'
  | 'RESET_REQUESTED'
  | 'RESET_APPROVED'
  | 'RESET_REJECTED'
  | 'RESET_COMPLETED'
  | 'USER_PASSWORD_RESET'
  | 'PROFILE_UPDATED';

export interface AuditEntry {
  id: number;
  userId: number | null;
  userName: string;
  userEmail: string;
  action: AuditAction;
  organizationId?: number | null;
  organization?: string | null;
  sourceId?: number | null;
  source?: string | null;
  detail?: string;
  ip: string;
  userAgent?: string;
  createdAt: string;
}

export type ResetRequestKind = 'LOGIN_PASSWORD' | 'VIEW_PASSWORD';
export type ResetRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'EXPIRED';

/**
 * Covers both self-service login resets (OTP based) and "reset view password"
 * requests, which need a System Admin to approve before a link is issued.
 */
export interface ResetRequest {
  id: number;
  kind: ResetRequestKind;
  userId: number;
  userName: string;
  userEmail: string;
  status: ResetRequestStatus;
  reason?: string;
  /** SHA-256 of the OTP / one-time token. The plaintext only ever goes by email. */
  tokenHash?: string | null;
  expiresAt?: string | null;
  attempts: number;
  requestedAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  completedAt?: string | null;
}

/** Uniform envelope returned by every API route. */
export type ApiResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields?: Record<string, string> };

export interface SessionPayload {
  sub: number;
  email: string;
  name: string;
  role: Role;
  /**
   * Absolute session deadline (unix seconds), fixed at sign-in.
   *
   * The token's own `exp` is the *idle* deadline and slides forward as the user
   * works; `abs` is the ceiling that sliding can never push past. Without it a
   * stolen cookie could be kept alive forever just by polling the API.
   */
  abs: number;
}
