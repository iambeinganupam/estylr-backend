// ─────────────────────────────────────────────────────────────────────────────
// Admin Bookings — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminBookingsRepository, type BookingDetail, type BookingRow } from './admin-bookings.repository';
import type { BookingListQuery, BookingUpdateBody } from './admin-bookings.schemas';

export const adminBookingsService = {
  async list(q: BookingListQuery): Promise<{ data: BookingRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminBookingsRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<BookingDetail> {
    const row = await adminBookingsRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Booking not found');
    return row;
  },

  async update(id: string, body: BookingUpdateBody, req: Request): Promise<BookingDetail> {
    const before = await adminBookingsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Booking not found');

    await adminBookingsRepository.update(id, body, req.auth!.userId);
    const after = await adminBookingsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Booking not found after update');

    let action: typeof AUDIT_ACTION[keyof typeof AUDIT_ACTION] = AUDIT_ACTION.BOOKING_UPDATE;
    if (body.status === 'cancelled')  action = AUDIT_ACTION.BOOKING_FORCE_CANCEL;
    if (body.status === 'completed')  action = AUDIT_ACTION.BOOKING_FORCE_COMPLETE;

    await recordAudit({
      action,
      entityType: AUDIT_ENTITY.BOOKING,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });
    return after;
  },
};
