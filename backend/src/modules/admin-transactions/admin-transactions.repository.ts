// ─────────────────────────────────────────────────────────────────────────────
// Admin Transactions — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { TransactionListQuery } from './admin-transactions.schemas';

export interface TransactionRow {
  id: string;
  appointment_id: string | null;
  vendor_id: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  status: string;
  external_ref: string | null;
  platform_fee: number;
  vendor_payout: number;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  created_at: string;
}

export const adminTransactionsRepository = {
  async list(q: TransactionListQuery): Promise<{ rows: TransactionRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.status && q.status !== 'all')                 push('t.status = ?', q.status);
    if (q.vendor_id)                                    push('t.vendor_id = ?', q.vendor_id);
    if (q.payment_method && q.payment_method !== 'all') push('t.payment_method = ?', q.payment_method);
    if (q.from)                                         push('t.created_at >= ?', q.from);
    if (q.to)                                           push('t.created_at <= ?', q.to);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(`(LOWER(COALESCE(t.external_ref, '')) LIKE ${p} OR LOWER(t.id::text) LIKE ${p})`);
    }
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(`(t.created_at, t.id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<TransactionRow>(
      `SELECT t.id, t.appointment_id, t.vendor_id,
              t.amount::float8 AS amount, t.currency,
              t.payment_method::text AS payment_method,
              t.status::text AS status,
              t.external_ref,
              t.platform_fee::float8 AS platform_fee,
              t.vendor_payout::float8 AS vendor_payout,
              t.refund_amount::float8 AS refund_amount,
              t.refund_reason, t.refunded_at,
              t.created_at
       FROM public.transactions t
       ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ${limitParam}`,
      params,
    );
    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<TransactionRow | null> {
    return queryOne<TransactionRow>(
      `SELECT t.id, t.appointment_id, t.vendor_id,
              t.amount::float8 AS amount, t.currency,
              t.payment_method::text AS payment_method,
              t.status::text AS status,
              t.external_ref,
              t.platform_fee::float8 AS platform_fee,
              t.vendor_payout::float8 AS vendor_payout,
              t.refund_amount::float8 AS refund_amount,
              t.refund_reason, t.refunded_at,
              t.created_at
       FROM public.transactions t
       WHERE t.id = $1`,
      [id],
    );
  },

  async markSettled(id: string, externalRef: string): Promise<void> {
    try {
      await query(
        `UPDATE public.transactions
           SET status = 'completed', external_ref = $2, updated_at = NOW()
         WHERE id = $1`,
        [id, externalRef],
      );
    } catch (e) { mapPgError(e); }
  },

  async manualRefund(id: string, amount: number, reason: string): Promise<void> {
    try {
      await query(
        `UPDATE public.transactions
           SET status = 'refunded',
               refund_amount = $2,
               refund_reason = $3,
               refunded_at = NOW(),
               updated_at = NOW()
         WHERE id = $1`,
        [id, amount, reason],
      );
    } catch (e) { mapPgError(e); }
  },
};
