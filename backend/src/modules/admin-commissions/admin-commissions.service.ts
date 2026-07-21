// ─────────────────────────────────────────────────────────────────────────────
// Admin Commissions — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ConflictError, ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import {
  adminCommissionsRepository,
  type CommissionByVendorRow,
  type CommissionRow,
  type CommissionSummary,
} from './admin-commissions.repository';
import type {
  CommissionAdjustBody,
  CommissionLedgerQuery,
  CommissionSummaryQuery,
  CommissionWaiveBody,
} from './admin-commissions.schemas';

export const adminCommissionsService = {
  async ledger(q: CommissionLedgerQuery): Promise<{ data: CommissionRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminCommissionsRepository.listLedger(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async summary(q: CommissionSummaryQuery): Promise<{
    kpis: CommissionSummary;
    by_vendor: CommissionByVendorRow[];
  }> {
    const [kpis, by_vendor] = await Promise.all([
      adminCommissionsRepository.getSummary(q),
      adminCommissionsRepository.listByVendor(q),
    ]);
    return { kpis, by_vendor };
  },

  async waive(id: string, body: CommissionWaiveBody, req: Request): Promise<CommissionRow> {
    const before = await adminCommissionsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Commission entry not found');
    if (before.status === 'waived') throw new ConflictError('Already waived');
    if (before.entry_type !== 'commission_accrual') {
      throw new ConflictError('Only commission accruals can be waived');
    }

    await adminCommissionsRepository.waive(id, body.reason, req.auth!.userId);
    const after = await adminCommissionsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Commission entry not found after update');

    await recordAudit({
      action: AUDIT_ACTION.COMMISSION_WAIVE,
      entityType: AUDIT_ENTITY.COMMISSION,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });

    return after;
  },

  async adjust(body: CommissionAdjustBody, req: Request): Promise<CommissionRow> {
    const id = await adminCommissionsRepository.appendAdjustment({
      vendor_type: body.vendor_type,
      vendor_id:   body.vendor_id,
      amount:      body.amount,
      reason:      body.reason,
      userId:      req.auth!.userId,
    });
    const after = await adminCommissionsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Adjustment row not found after insert');

    await recordAudit({
      action: AUDIT_ACTION.COMMISSION_ADJUST,
      entityType: AUDIT_ENTITY.COMMISSION,
      entityId: id,
      after,
      reason: body.reason,
      req,
    });
    return after;
  },
};
