// ─────────────────────────────────────────────────────────────────────────────
// Admin Transactions — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ConflictError, ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import {
  adminTransactionsRepository,
  type TransactionRow,
} from './admin-transactions.repository';
import type {
  TransactionListQuery,
  TxManualRefundBody,
  TxMarkSettledBody,
} from './admin-transactions.schemas';

export const adminTransactionsService = {
  async list(q: TransactionListQuery): Promise<{ data: TransactionRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminTransactionsRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<TransactionRow> {
    const row = await adminTransactionsRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Transaction not found');
    return row;
  },

  async markSettled(id: string, body: TxMarkSettledBody, req: Request): Promise<TransactionRow> {
    const before = await adminTransactionsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Transaction not found');
    if (before.status !== 'pending') {
      throw new ConflictError(`Only pending transactions can be marked settled (current: ${before.status})`);
    }
    await adminTransactionsRepository.markSettled(id, body.external_ref);
    const after = await adminTransactionsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Transaction not found after update');
    await recordAudit({
      action: AUDIT_ACTION.TRANSACTION_MARK_SETTLED,
      entityType: AUDIT_ENTITY.TRANSACTION,
      entityId: id,
      before, after,
      reason: body.reason ?? `Settled with ref ${body.external_ref}`,
      req,
    });
    return after;
  },

  async manualRefund(id: string, body: TxManualRefundBody, req: Request): Promise<TransactionRow> {
    const before = await adminTransactionsRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Transaction not found');
    if (before.status !== 'completed') {
      throw new ConflictError('Only completed transactions can be refunded');
    }
    // Both values are in rupees (NUMERIC) — comparison is unit-consistent.
    if (body.refund_amount > before.amount) {
      throw new ConflictError('Refund amount exceeds transaction amount');
    }
    await adminTransactionsRepository.manualRefund(id, body.refund_amount, body.refund_reason);
    const after = await adminTransactionsRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Transaction not found after update');
    await recordAudit({
      action: AUDIT_ACTION.TRANSACTION_REFUND,
      entityType: AUDIT_ENTITY.TRANSACTION,
      entityId: id,
      before, after,
      reason: body.refund_reason,
      req,
    });
    return after;
  },
};
