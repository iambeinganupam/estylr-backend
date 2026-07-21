// ─────────────────────────────────────────────────────────────────────────────
// Admin Media — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminMediaRepository, type MediaRow } from './admin-media.repository';
import type { MediaDeleteBody, MediaListQuery, MediaUpdateBody } from './admin-media.schemas';

export const adminMediaService = {
  async list(q: MediaListQuery): Promise<{ data: MediaRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminMediaRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<MediaRow> {
    const row = await adminMediaRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Media item not found');
    return row;
  },

  async update(id: string, body: MediaUpdateBody, req: Request): Promise<MediaRow> {
    const before = await adminMediaRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Media item not found');
    await adminMediaRepository.update(id, body);
    const after = await adminMediaRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Media item not found after update');
    await recordAudit({
      action: AUDIT_ACTION.MEDIA_UPDATE,
      entityType: AUDIT_ENTITY.MEDIA,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });
    return after;
  },

  async delete(id: string, body: MediaDeleteBody, req: Request): Promise<void> {
    const before = await adminMediaRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Media item not found');
    await adminMediaRepository.delete(id);
    await recordAudit({
      action: AUDIT_ACTION.MEDIA_DELETE,
      entityType: AUDIT_ENTITY.MEDIA,
      entityId: id,
      before,
      reason: body.reason,
      req,
    });
  },
};
