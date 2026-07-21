// ─────────────────────────────────────────────────────────────────────────────
// Payments Module — Repository
// ─────────────────────────────────────────────────────────────────────────────
// Raw SQL via `query`/`queryOne`. No business logic.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import type { TxStatus } from '../../lib/constants';
import type { RecordPaymentAttemptInput, ListTransactionsQuery } from './payments.schemas';

export interface TransactionRow {
  id: string;
  appointment_id: string | null;
  vendor_id: string;
  amount: string;
  currency: string;
  payment_method: string | null;
  status: TxStatus;
  external_ref: string | null;
  gateway_response: Record<string, unknown> | null;
  platform_fee: string;
  vendor_payout: string;
  refund_amount: string | null;
  refund_reason: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export const paymentsRepository = {
  async recordAttempt(input: RecordPaymentAttemptInput): Promise<TransactionRow> {
    // input.amount_paise is INTEGER paise from the Razorpay/gateway webhook
    // (defined in @kshuri/contracts/payments — do not rename).
    // Convert to rupees here: this is the ONLY place in the codebase that does
    // paise→rupees. The DB stores NUMERIC(10,2) rupees; gateway_amount_paise
    // (a generated column) handles the reverse for outbound provider calls.
    const amountRupees = input.amount_paise / 100;

    const row = await queryOne<TransactionRow>(
      `INSERT INTO public.transactions
         (appointment_id, vendor_id, amount, currency, payment_method,
          status, external_ref, gateway_response)
       VALUES ($1, $2, $3, $4, $5, $6::transaction_status, $7, $8)
       RETURNING *`,
      [
        input.appointment_id ?? null,
        input.vendor_id,
        amountRupees,
        input.currency,
        input.payment_method ?? null,
        input.status === 'settled' ? 'settled' : input.status,
        input.provider_ref ?? null,
        input.gateway_response ? JSON.stringify(input.gateway_response) : null,
      ],
    );

    return row!;
  },

  async updateStatus(
    id: string,
    status: TxStatus,
    payload?: Record<string, unknown>,
  ): Promise<TransactionRow | null> {
    return queryOne<TransactionRow>(
      `UPDATE public.transactions
          SET status = $2::transaction_status,
              gateway_response = COALESCE($3, gateway_response),
              updated_at = now()
        WHERE id = $1
       RETURNING *`,
      [id, status, payload ? JSON.stringify(payload) : null],
    );
  },

  async findById(id: string): Promise<TransactionRow | null> {
    return queryOne<TransactionRow>(
      'SELECT * FROM public.transactions WHERE id = $1',
      [id],
    );
  },

  async listForVendor(
    vendorId: string,
    params: ListTransactionsQuery,
  ): Promise<{ rows: TransactionRow[]; total: number }> {
    const conditions: string[] = ['vendor_id = $1'];
    const args: unknown[] = [vendorId];
    let p = 2;

    if (params.status) {
      conditions.push(`status = $${p++}::transaction_status`);
      args.push(params.status);
    }
    if (params.from_date) {
      conditions.push(`created_at >= $${p++}::date`);
      args.push(params.from_date);
    }
    if (params.to_date) {
      conditions.push(`created_at < ($${p++}::date + interval '1 day')`);
      args.push(params.to_date);
    }

    const where = conditions.join(' AND ');

    const countResult = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM public.transactions WHERE ${where}`,
      args,
    );
    const total = parseInt(countResult?.total ?? '0', 10);

    const rows = await query<TransactionRow>(
      `SELECT * FROM public.transactions
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...args, params.limit, params.offset],
    );

    return { rows: rows.rows, total };
  },

  async findRefundCandidate(id: string): Promise<TransactionRow | null> {
    return queryOne<TransactionRow>(
      `SELECT * FROM public.transactions
        WHERE id = $1 AND status = 'settled' AND refunded_at IS NULL`,
      [id],
    );
  },

  async applyRefund(
    id: string,
    refundAmount: number,
    reason: string,
  ): Promise<TransactionRow | null> {
    return queryOne<TransactionRow>(
      `UPDATE public.transactions
          SET status = 'refunded'::transaction_status,
              refund_amount = $2,
              refund_reason = $3,
              refunded_at = now(),
              updated_at = now()
        WHERE id = $1
       RETURNING *`,
      [id, refundAmount, reason],
    );
  },
};
