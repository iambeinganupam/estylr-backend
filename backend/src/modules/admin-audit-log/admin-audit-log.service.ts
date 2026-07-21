// ─────────────────────────────────────────────────────────────────────────────
// Admin Audit Log — Service
// ─────────────────────────────────────────────────────────────────────────────

import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { adminAuditLogRepository, type AuditRow } from './admin-audit-log.repository';
import type { AuditListQuery } from './admin-audit-log.schemas';

export const adminAuditLogService = {
  async list(q: AuditListQuery): Promise<{ data: AuditRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminAuditLogRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<AuditRow> {
    const row = await adminAuditLogRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Audit log entry not found');
    return row;
  },
};
