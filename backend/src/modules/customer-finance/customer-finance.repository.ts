// ─────────────────────────────────────────────────────────────────────────────
// Customer Finance — Repository
// ─────────────────────────────────────────────────────────────────────────────
// Read-only queries scoped to the calling customer's own transactions.
// Customer ownership is asserted at the SQL layer by JOINing
// transactions → appointments → customer_id, where customer_id == users.id
// (since customer_profiles is keyed on user_id, the customer's profileId == userId).
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import type {
  CustomerTransaction,
  RefundsListQuery,
  TransactionsListQuery,
} from './customer-finance.schemas';

interface TxRow {
  id: string;
  appointment_id: string | null;
  vendor_name: string | null;
  amount: string;
  currency: string;
  payment_method: 'upi' | 'card' | 'cash' | 'online' | null;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  subtotal: string | null;
  tax_amount: string | null;
  bill_number: string | null;
  refund_amount: string | null;
  refund_reason: string | null;
  refunded_at: string | null;
  created_at: string;
}

function mapTx(r: TxRow): CustomerTransaction {
  const refundAmt = r.refund_amount != null ? Number(r.refund_amount) : 0;
  const hasRefund = (r.refunded_at != null) || refundAmt > 0;
  return {
    id: r.id,
    appointmentId: r.appointment_id,
    vendorName: r.vendor_name,
    amount: Number(r.amount),
    currency: r.currency.trim(),
    method: r.payment_method,
    status: r.status,
    subtotal: r.subtotal != null ? Number(r.subtotal) : null,
    tax_amount: r.tax_amount != null ? Number(r.tax_amount) : null,
    billNumber: r.bill_number,
    refund: hasRefund && r.refunded_at
      ? { amount: refundAmt, reason: r.refund_reason, refundedAt: r.refunded_at }
      : null,
    createdAt: r.created_at,
  };
}

// Shared SELECT projection. `vendor_name` resolves polymorphically via the
// appointment's vendor_type pointer.
const TX_SELECT_CORE = `
  SELECT
    t.id,
    t.appointment_id,
    CASE
      WHEN a.vendor_type = 'freelancer'
        THEN (SELECT business_name FROM public.freelancer_profiles WHERE id = a.vendor_id)
      WHEN a.vendor_type = 'salon_location'
        THEN (SELECT display_name  FROM public.salon_locations    WHERE id = a.vendor_id)
      ELSE NULL
    END AS vendor_name,
    t.amount,
    t.currency,
    t.payment_method,
    t.status,
    t.subtotal,
    t.tax_amount,
    t.bill_number,
    t.refund_amount,
    t.refund_reason,
    t.refunded_at,
    t.created_at
  FROM public.transactions t
  LEFT JOIN public.appointments a ON a.id = t.appointment_id
`;

export interface PageResult<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

function encodeCursor(createdAt: string): string {
  return Buffer.from(createdAt).toString('base64url');
}
function decodeCursor(cursor: string): string | null {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export const customerFinanceRepository = {
  async listTransactions(
    customerUserId: string,
    q: TransactionsListQuery,
  ): Promise<PageResult<CustomerTransaction>> {
    const filters: string[] = [`a.customer_id = $1`];
    const params: unknown[] = [customerUserId];

    if (q.status) {
      filters.push(`t.status = $${params.length + 1}`);
      params.push(q.status);
    }
    if (q.method) {
      filters.push(`t.payment_method = $${params.length + 1}`);
      params.push(q.method);
    }
    if (q.from) {
      filters.push(`t.created_at >= $${params.length + 1}`);
      params.push(q.from);
    }
    if (q.to) {
      filters.push(`t.created_at <= $${params.length + 1}`);
      params.push(q.to);
    }
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded) {
        filters.push(`t.created_at < $${params.length + 1}`);
        params.push(decoded);
      }
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    params.push(q.limit + 1);
    const limitParam = `$${params.length}`;

    const result = await query<TxRow>(
      `${TX_SELECT_CORE}
       ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const rows = result.rows.map(mapTx);
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    const last = data[data.length - 1];
    const next_cursor = hasMore && last ? encodeCursor(last.createdAt) : null;

    return { data, next_cursor, has_more: hasMore };
  },

  async getTransaction(
    customerUserId: string,
    transactionId: string,
  ): Promise<CustomerTransaction | null> {
    const row = await queryOne<TxRow>(
      `${TX_SELECT_CORE}
       WHERE t.id = $1 AND a.customer_id = $2
       LIMIT 1`,
      [transactionId, customerUserId],
    );
    return row ? mapTx(row) : null;
  },

  /**
   * Refunds aren't a separate table. We surface "refunds" as the subset of
   * transactions where a refund has been recorded (refunded_at IS NOT NULL OR
   * status = 'refunded'). Same shape as transactions for client simplicity.
   */
  async listRefunds(
    customerUserId: string,
    q: RefundsListQuery,
  ): Promise<PageResult<CustomerTransaction>> {
    const filters: string[] = [
      `a.customer_id = $1`,
      `(t.refunded_at IS NOT NULL OR t.status = 'refunded')`,
    ];
    const params: unknown[] = [customerUserId];

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded) {
        filters.push(`COALESCE(t.refunded_at, t.created_at) < $${params.length + 1}`);
        params.push(decoded);
      }
    }

    params.push(q.limit + 1);
    const limitParam = `$${params.length}`;

    const result = await query<TxRow>(
      `${TX_SELECT_CORE}
       WHERE ${filters.join(' AND ')}
       ORDER BY COALESCE(t.refunded_at, t.created_at) DESC, t.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const rows = result.rows.map(mapTx);
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    const last = data[data.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor(last.refund?.refundedAt ?? last.createdAt)
      : null;

    return { data, next_cursor, has_more: hasMore };
  },
};
