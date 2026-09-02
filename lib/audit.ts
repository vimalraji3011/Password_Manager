import 'server-only';
import { Collection, FILES } from '@/lib/json-storage';
import type { AuditAction, AuditEntry, User } from '@/types';

/**
 * Append-only audit trail.
 *
 * Nothing in the app ever updates or deletes an audit row — that is the point
 * of an audit log. To keep the JSON file from growing without bound the writer
 * trims to the newest `MAX_ENTRIES`, which is plenty for an internal two-user
 * vault and keeps reads fast.
 */

const MAX_ENTRIES = 5_000;

export const auditLog = new Collection<AuditEntry>(FILES.audit);

export interface AuditInput {
  action: AuditAction;
  actor: Pick<User, 'id' | 'name' | 'email'> | { id: null; name: string; email: string };
  ip: string;
  userAgent?: string;
  organizationId?: number | null;
  organization?: string | null;
  sourceId?: number | null;
  source?: string | null;
  detail?: string;
}

/**
 * Record an auditable event. Never throws: a failure to log must not take down
 * the operation the user actually asked for, but it is loud in the server log.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const entry: Omit<AuditEntry, 'id'> = {
      userId: input.actor.id,
      userName: input.actor.name,
      userEmail: input.actor.email,
      action: input.action,
      organizationId: input.organizationId ?? null,
      organization: input.organization ?? null,
      sourceId: input.sourceId ?? null,
      source: input.source ?? null,
      detail: input.detail,
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: new Date().toISOString(),
    };

    await auditLog.insert(entry);

    const all = await auditLog.all();
    if (all.length > MAX_ENTRIES) {
      const cutoff = all[all.length - MAX_ENTRIES]!.id;
      await auditLog.removeWhere((item) => item.id < cutoff);
    }
  } catch (error) {
    console.error('[audit] failed to record entry', input.action, error);
  }
}

/** Newest-first, optionally filtered. Used by the audit page and dashboard. */
export async function listAudit(options?: {
  action?: AuditAction | 'ALL';
  userId?: number;
  search?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  const entries = await auditLog.all();
  const search = options?.search?.trim().toLowerCase();

  const filtered = entries.filter((entry) => {
    if (options?.action && options.action !== 'ALL' && entry.action !== options.action) return false;
    if (options?.userId && entry.userId !== options.userId) return false;
    if (search) {
      const haystack = [
        entry.userName,
        entry.userEmail,
        entry.action,
        entry.organization,
        entry.source,
        entry.detail,
        entry.ip,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return options?.limit ? filtered.slice(0, options.limit) : filtered;
}

/** Human-readable labels + intent colour for each action, shared by all views. */
export const ACTION_META: Record<AuditAction, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  LOGIN: { label: 'Signed in', tone: 'success' },
  LOGIN_FAILED: { label: 'Failed sign-in', tone: 'danger' },
  LOGOUT: { label: 'Signed out', tone: 'neutral' },
  PASSWORD_VIEWED: { label: 'Password revealed', tone: 'warning' },
  PASSWORD_UPDATED: { label: 'Password updated', tone: 'info' },
  SOURCE_CREATED: { label: 'Source created', tone: 'success' },
  SOURCE_UPDATED: { label: 'Source updated', tone: 'info' },
  SOURCE_DELETED: { label: 'Source deleted', tone: 'danger' },
  ORGANIZATION_CREATED: { label: 'Organization created', tone: 'success' },
  ORGANIZATION_UPDATED: { label: 'Organization updated', tone: 'info' },
  ORGANIZATION_DELETED: { label: 'Organization deleted', tone: 'danger' },
  RESET_REQUESTED: { label: 'Reset requested', tone: 'warning' },
  RESET_APPROVED: { label: 'Reset approved', tone: 'success' },
  RESET_REJECTED: { label: 'Reset rejected', tone: 'danger' },
  RESET_COMPLETED: { label: 'Reset completed', tone: 'success' },
  USER_PASSWORD_RESET: { label: 'User password reset', tone: 'warning' },
  PROFILE_UPDATED: { label: 'Profile updated', tone: 'info' },
};
