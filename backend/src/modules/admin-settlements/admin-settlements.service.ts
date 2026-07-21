// ─────────────────────────────────────────────────────────────────────────────
// Admin Settlements — Service
// ─────────────────────────────────────────────────────────────────────────────

import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import {
  adminSettlementsRepository,
  type SettlementRow,
  type SettlementSummary,
} from './admin-settlements.repository';
import type {
  SettlementListQuery,
  SettlementSummaryQuery,
} from './admin-settlements.schemas';

export const adminSettlementsService = {
  async list(q: SettlementListQuery): Promise<{ data: SettlementRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminSettlementsRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<SettlementRow> {
    const row = await adminSettlementsRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Settlement not found');
    return row;
  },

  async summary(q: SettlementSummaryQuery): Promise<SettlementSummary> {
    return adminSettlementsRepository.getSummary(q);
  },
};
