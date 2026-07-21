// ─────────────────────────────────────────────────────────────────────────────
// Admin Vendors — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ConflictError, ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminVendorsRepository, type VendorDetail, type VendorRow } from './admin-vendors.repository';
import type {
  VendorCreateBody,
  VendorDeleteBody,
  VendorListQuery,
  VendorUpdateBody,
} from './admin-vendors.schemas';

export const adminVendorsService = {
  async list(q: VendorListQuery): Promise<{ data: VendorRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminVendorsRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<VendorDetail> {
    const row = await adminVendorsRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Vendor not found');
    return row;
  },

  async update(id: string, patch: VendorUpdateBody, req: Request): Promise<VendorDetail> {
    const before = await adminVendorsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Vendor not found');

    if (before.vendor_type === 'salon_location' && patch.commission_percentage !== undefined) {
      throw new ConflictError('Salon commission is configured per business plan, not per location');
    }

    const after = await adminVendorsRepository.update(id, before.vendor_type, patch);
    if (!after) throw new ResourceNotFoundError('Vendor not found after update');

    // Pick the correct audit verb based on which field actually moved.
    let action: typeof AUDIT_ACTION[keyof typeof AUDIT_ACTION] = AUDIT_ACTION.VENDOR_UPDATE;
    if (patch.is_active !== undefined) {
      action = patch.is_active ? AUDIT_ACTION.VENDOR_REINSTATE : AUDIT_ACTION.VENDOR_SUSPEND;
    } else if (patch.is_verified === true) {
      action = AUDIT_ACTION.KYC_FORCE_VERIFY;
    } else if (patch.commission_percentage !== undefined) {
      action = AUDIT_ACTION.VENDOR_COMMISSION_SET;
    }

    await recordAudit({
      action,
      entityType: AUDIT_ENTITY.VENDOR,
      entityId: id,
      before, after,
      reason: patch.reason,
      req,
    });

    return after;
  },

  async create(body: VendorCreateBody, req: Request): Promise<VendorDetail> {
    const created = await adminVendorsRepository.create(body);
    const after = await adminVendorsRepository.getById(created.id);
    if (!after) throw new ResourceNotFoundError('Vendor not found after create');

    await recordAudit({
      action: AUDIT_ACTION.VENDOR_CREATE,
      entityType: AUDIT_ENTITY.VENDOR,
      entityId: created.id,
      after,
      reason: 'Admin-initiated onboarding',
      req,
    });
    return after;
  },

  async softDelete(id: string, body: VendorDeleteBody, req: Request): Promise<void> {
    const before = await adminVendorsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Vendor not found');
    if (!before.is_active) throw new ConflictError('Vendor is already deactivated');

    await adminVendorsRepository.softDelete(id, before.vendor_type);

    await recordAudit({
      action: AUDIT_ACTION.VENDOR_DELETE,
      entityType: AUDIT_ENTITY.VENDOR,
      entityId: id,
      before, after: { ...before, is_active: false },
      reason: body.reason,
      req,
    });
  },
};
