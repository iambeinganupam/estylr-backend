// ─────────────────────────────────────────────────────────────────────────────
// Admin Reviews — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminReviewsRepository, type ReviewRow } from './admin-reviews.repository';
import type { ReviewListQuery, ReviewModerateBody } from './admin-reviews.schemas';

export const adminReviewsService = {
  async list(q: ReviewListQuery): Promise<{ data: ReviewRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminReviewsRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<ReviewRow> {
    const row = await adminReviewsRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Review not found');
    return row;
  },

  async moderate(id: string, body: ReviewModerateBody, req: Request): Promise<ReviewRow> {
    const before = await adminReviewsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Review not found');
    await adminReviewsRepository.setVisible(id, body.action === 'unhide');
    const after = await adminReviewsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Review not found after update');
    await recordAudit({
      action: body.action === 'hide' ? AUDIT_ACTION.REVIEW_HIDE : AUDIT_ACTION.REVIEW_UNHIDE,
      entityType: AUDIT_ENTITY.REVIEW,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });
    return after;
  },
};
