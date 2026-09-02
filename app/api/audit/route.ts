import { ok, withAuth } from '@/lib/api';
import { listAudit } from '@/lib/audit';
import type { AuditAction, AuditEntry } from '@/types';

/**
 * GET /api/audit?action=&search=&limit=
 *
 * Admin only. The audit log records who revealed which credential and from what
 * IP, so exposing it to viewers would leak the access pattern of the whole
 * organization.
 */
export const GET = withAuth<{ entries: AuditEntry[]; total: number }>(
  async ({ request }) => {
    const params = new URL(request.url).searchParams;

    const actionParam = params.get('action');
    const action = actionParam && actionParam !== 'ALL' ? (actionParam as AuditAction) : 'ALL';

    const limitParam = Number(params.get('limit'));
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : undefined;

    const all = await listAudit({ action, search: params.get('search') ?? '' });

    return ok({ entries: limit ? all.slice(0, limit) : all, total: all.length });
  },
  { role: 'admin' },
);
