// ─────────────────────────────────────────────────────────────────────────────
// Admin Staff — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminStaffRepository, type StaffRow } from './admin-staff.repository';
import { staffService } from '../staff/staff.service';
import type { StaffListQuery, StaffUpdateBody } from './admin-staff.schemas';

export const adminStaffService = {
  async list(q: StaffListQuery): Promise<{ data: StaffRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminStaffRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<StaffRow> {
    const row = await adminStaffRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Staff member not found');
    return row;
  },

  async update(id: string, body: StaffUpdateBody, req: Request): Promise<StaffRow> {
    const before = await adminStaffRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Staff member not found');
    if (body.role !== undefined) await staffService.assertValidRoleCode(body.role);
    await adminStaffRepository.update(id, body);
    const after = await adminStaffRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Staff member not found after update');

    let action: typeof AUDIT_ACTION[keyof typeof AUDIT_ACTION] = AUDIT_ACTION.STAFF_UPDATE;
    if (body.is_active === false) action = AUDIT_ACTION.STAFF_DEACTIVATE;
    if (body.is_active === true && !before.is_active) action = AUDIT_ACTION.STAFF_REINSTATE;

    await recordAudit({
      action,
      entityType: AUDIT_ENTITY.STAFF,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });
    return after;
  },
};
