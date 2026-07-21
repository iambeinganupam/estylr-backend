// ─────────────────────────────────────────────────────────────────────────────
// Admin Refunds — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { query, queryOne } from '../../config/database';
import { ConflictError, ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY, REFUND_STATUS } from '../../lib/constants';
import { adminRefundsRepository, type RefundRow } from './admin-refunds.repository';
import type {
  RefundCompleteBody,
  RefundCreateBody,
  RefundDecisionBody,
  RefundListQuery,
} from './admin-refunds.schemas';

export const adminRefundsService = {
  async list(q: RefundListQuery): Promise<{ data: RefundRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminRefundsRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<RefundRow> {
    const row = await adminRefundsRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Refund request not found');
    return row;
  },

  async resolve(id: string, body: RefundDecisionBody, req: Request): Promise<RefundRow> {
    const before = await adminRefundsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Refund request not found');
    if (before.status !== REFUND_STATUS.PENDING) {
      throw new ConflictError(`Refund is already ${before.status}`);
    }

    const decision = body.action === 'approve' ? REFUND_STATUS.APPROVED : REFUND_STATUS.REJECTED;
    await adminRefundsRepository.resolve(id, decision, body.note, req.auth!.userId);
    const after = await adminRefundsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Refund request not found after update');

    await recordAudit({
      action: body.action === 'approve' ? AUDIT_ACTION.REFUND_APPROVE : AUDIT_ACTION.REFUND_REJECT,
      entityType: AUDIT_ENTITY.REFUND,
      entityId: id,
      before, after,
      reason: body.note,
      req,
    });

    // For approvals, emit a downstream-job marker (a job table or queue is
    // out of scope for v1; the spec calls out "queue it for a job"). We
    // append a dues-ledger adjustment row so the vendor's balance reflects
    // the imminent refund — the actual provider call lives in a future job.
    if (decision === REFUND_STATUS.APPROVED) {
      await this.recordRefundLedger(after, req.auth!.userId);
    }

    return after;
  },

  async createAdminInitiated(body: RefundCreateBody, req: Request): Promise<RefundRow> {
    const appt = await queryOne<{ id: string; customer_id: string; vendor_type: string; vendor_id: string }>(
      `SELECT id, customer_id, vendor_type, vendor_id
       FROM public.appointments WHERE id = $1`,
      [body.appointment_id],
    );
    if (!appt) throw new ResourceNotFoundError('Appointment not found');

    const created = await adminRefundsRepository.createAdminInitiated({
      appointment_id: appt.id,
      customer_id:    appt.customer_id,
      vendor_type:    appt.vendor_type,
      vendor_id:      appt.vendor_id,
      amount:         body.amount,   // already rupees (NUMERIC) from the validated schema
      reason:         body.reason,
      actingUserId:   req.auth!.userId,
    });
    if (!created) throw new ConflictError('Refund creation failed');

    await recordAudit({
      action: AUDIT_ACTION.REFUND_CREATE,
      entityType: AUDIT_ENTITY.REFUND,
      entityId: created.id,
      after: created,
      reason: body.reason,
      req,
    });

    await this.recordRefundLedger(created, req.auth!.userId);
    return created;
  },

  async markCompleted(id: string, body: RefundCompleteBody, req: Request): Promise<RefundRow> {
    const before = await adminRefundsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Refund request not found');
    if (before.status !== REFUND_STATUS.APPROVED) {
      throw new ConflictError(`Refund must be approved before completion (current: ${before.status})`);
    }

    await adminRefundsRepository.markCompleted(id, body.provider_ref);
    const after = await adminRefundsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Refund request not found after update');

    await recordAudit({
      action: AUDIT_ACTION.REFUND_COMPLETE,
      entityType: AUDIT_ENTITY.REFUND,
      entityId: id,
      before, after,
      reason: body.note ?? `Provider ref: ${body.provider_ref}`,
      req,
    });
    return after;
  },

  /**
   * Append an adjustment row to the dues ledger reflecting the refund. The
   * sign is positive (vendor owes back to platform) since the customer's
   * money is being returned out of the platform's collected commission.
   * refund.amount is NUMERIC(10,2) in INR (rupees) — no unit conversion needed.
   */
  async recordRefundLedger(refund: RefundRow, actingUserId: string): Promise<void> {
    await query(
      `INSERT INTO public.vendor_dues_ledger
         (vendor_type, vendor_id, transaction_id, entry_type, amount, balance_after, notes, created_by)
       SELECT $1::vendor_type,
              $2,
              NULL,
              'adjustment'::vendor_dues_entry_type,
              $3,
              COALESCE((SELECT balance_after FROM public.vendor_dues_ledger
                         WHERE vendor_type = $1::vendor_type AND vendor_id = $2
                         ORDER BY created_at DESC LIMIT 1), 0) + $3,
              'refund:' || $4,
              $5`,
      [refund.vendor_type, refund.vendor_id, refund.amount, refund.id, actingUserId],
    );
  },
};
