// ─────────────────────────────────────────────────────────────────────────────
// Admin Audit Log — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { decodeCursor } from '../../lib/pagination';
import type { AuditListQuery } from './admin-audit-log.schemas';

export interface AuditRow {
  id: string;
  admin_user_id: string;
  admin_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload_before: unknown;
  payload_after: unknown;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

export const adminAuditLogRepository = {
  async list(q: AuditListQuery): Promise<{ rows: AuditRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.admin_id)    push('al.admin_user_id = ?', q.admin_id);
    if (q.action)      push('al.action = ?', q.action);
    if (q.entity_type) push('al.entity_type = ?', q.entity_type);
    if (q.entity_id)   push('al.entity_id = ?', q.entity_id);
    if (q.from)        push('al.created_at >= ?', q.from);
    if (q.to)          push('al.created_at <= ?', q.to);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(al.action) LIKE ${p} OR LOWER(COALESCE(al.reason,'')) LIKE ${p} OR LOWER(COALESCE(u.email,'')) LIKE ${p})`,
      );
    }

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(
          `(al.created_at, al.id) < ($${params.length - 1}, $${params.length})`,
        );
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1); // fetch one extra to detect has_more

    const result = await query<AuditRow>(
      `SELECT al.id,
              al.admin_user_id,
              u.email AS admin_email,
              al.action,
              al.entity_type,
              al.entity_id,
              al.payload_before,
              al.payload_after,
              al.reason,
              al.ip_address::text AS ip_address,
              al.user_agent,
              al.request_id,
              al.created_at
       FROM public.audit_log al
       LEFT JOIN public.users u ON u.id = al.admin_user_id
       ${where}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<AuditRow | null> {
    return queryOne<AuditRow>(
      `SELECT al.id,
              al.admin_user_id,
              u.email AS admin_email,
              al.action,
              al.entity_type,
              al.entity_id,
              al.payload_before,
              al.payload_after,
              al.reason,
              al.ip_address::text AS ip_address,
              al.user_agent,
              al.request_id,
              al.created_at
       FROM public.audit_log al
       LEFT JOIN public.users u ON u.id = al.admin_user_id
       WHERE al.id = $1`,
      [id],
    );
  },
};
