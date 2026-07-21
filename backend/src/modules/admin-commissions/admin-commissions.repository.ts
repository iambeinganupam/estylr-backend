// ─────────────────────────────────────────────────────────────────────────────
// Admin Commissions — Repository
// ─────────────────────────────────────────────────────────────────────────────
// Reads from `vendor_dues_ledger` (migration 039). Each row is a per-line
// commission accrual or settlement; status is derived from entry_type plus
// waive flag (kept in `notes` prefix `[waived]` for v1; v2 should add a
// dedicated status column).
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type {
  CommissionLedgerQuery,
  CommissionSummaryQuery,
} from './admin-commissions.schemas';

export interface CommissionRow {
  id: string;
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  vendor_city: string | null;
  transaction_id: string | null;
  appointment_id: string | null;
  entry_type: string;
  /** Ledger amount in INR (rupees), signed. Positive = vendor owes; negative = credit. */
  amount: number;
  /** Running balance after this entry, in INR (rupees). */
  balance_after: number;
  notes: string | null;
  status: 'collected' | 'pending' | 'waived';
  created_at: string;
}

export interface CommissionSummary {
  /** Commissions collected this month, in INR (rupees). */
  collected_mtd: number;
  outstanding_arrears: number;
  vendors_in_arrears: number;
  total_settled: number;
}

export interface CommissionByVendorRow {
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  total_billed: number;
  total_settled: number;
  arrears: number;
  last_settlement_at: string | null;
}

const VENDOR_NAME_SQL = `
  CASE WHEN l.vendor_type = 'freelancer'
       THEN (SELECT business_name FROM public.freelancer_profiles WHERE id = l.vendor_id)
       ELSE (SELECT display_name  FROM public.salon_locations    WHERE id = l.vendor_id)
  END
`;

const VENDOR_CITY_SQL = `
  CASE WHEN l.vendor_type = 'freelancer'
       THEN (SELECT city FROM public.freelancer_profiles WHERE id = l.vendor_id)
       ELSE (SELECT city FROM public.salon_locations    WHERE id = l.vendor_id)
  END
`;

// Status derivation: a `commission_accrual` is "pending" until the vendor's
// outstanding balance settles, then "collected"; rows with "[waived]" prefix
// in notes are "waived". Settlement and adjustment rows are not exposed in
// the ledger view (they aren't commission lines).
const STATUS_SQL = `
  CASE
    WHEN COALESCE(l.notes, '') LIKE '[waived]%'      THEN 'waived'
    WHEN l.entry_type = 'commission_accrual'         THEN 'pending'
    ELSE 'collected'
  END
`;

export const adminCommissionsRepository = {
  async listLedger(q: CommissionLedgerQuery): Promise<{ rows: CommissionRow[]; hasMore: boolean }> {
    const conditions: string[] = ["l.entry_type = 'commission_accrual'"];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.vendor_id)   push('l.vendor_id = ?', q.vendor_id);
    if (q.vendor_type) push('l.vendor_type = ?', q.vendor_type);
    if (q.from)        push('l.created_at >= ?', q.from);
    if (q.to)          push('l.created_at <= ?', q.to);
    if (q.status && q.status !== 'all') {
      params.push(q.status);
      conditions.push(`(${STATUS_SQL}) = $${params.length}`);
    }

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(
          `(l.created_at, l.id) < ($${params.length - 1}, $${params.length})`,
        );
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<CommissionRow>(
      `SELECT l.id,
              l.vendor_type::text AS vendor_type,
              l.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              ${VENDOR_CITY_SQL} AS vendor_city,
              l.transaction_id,
              t.appointment_id,
              l.entry_type::text AS entry_type,
              l.amount::float8 AS amount,
              l.balance_after::float8 AS balance_after,
              l.notes,
              ${STATUS_SQL} AS status,
              l.created_at
       FROM public.vendor_dues_ledger l
       LEFT JOIN public.transactions t ON t.id = l.transaction_id
       ${where}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getSummary(q: CommissionSummaryQuery): Promise<CommissionSummary> {
    const params: unknown[] = [];
    let timeFilter = '';
    if (q.from) { params.push(q.from); timeFilter += ` AND created_at >= $${params.length}`; }
    if (q.to)   { params.push(q.to);   timeFilter += ` AND created_at <= $${params.length}`; }

    const collected = await queryOne<{ v: number }>(
      `SELECT COALESCE(SUM(amount), 0)::float8 AS v
       FROM public.vendor_dues_ledger
       WHERE entry_type = 'commission_accrual'
         AND COALESCE(notes, '') NOT LIKE '[waived]%'
         AND created_at >= date_trunc('month', NOW())`,
    );

    const settled = await queryOne<{ v: number }>(
      `SELECT COALESCE(-SUM(amount), 0)::float8 AS v
       FROM public.vendor_dues_ledger
       WHERE entry_type = 'settlement_payment' ${timeFilter}`,
      params,
    );

    const arrearsAgg = await queryOne<{ outstanding: number; vendors: number }>(
      `SELECT COALESCE(SUM(GREATEST(outstanding, 0)), 0)::float8 AS outstanding,
              COUNT(*) FILTER (WHERE outstanding > 0)::int AS vendors
       FROM public.vendor_outstanding_balance`,
    );

    return {
      collected_mtd:       collected?.v ?? 0,
      total_settled:       settled?.v ?? 0,
      outstanding_arrears: arrearsAgg?.outstanding ?? 0,
      vendors_in_arrears:  arrearsAgg?.vendors ?? 0,
    };
  },

  async listByVendor(q: CommissionSummaryQuery): Promise<CommissionByVendorRow[]> {
    const params: unknown[] = [];
    let timeFilter = '';
    if (q.from) { params.push(q.from); timeFilter += ` AND l.created_at >= $${params.length}`; }
    if (q.to)   { params.push(q.to);   timeFilter += ` AND l.created_at <= $${params.length}`; }

    const result = await query<CommissionByVendorRow>(
      `SELECT l.vendor_type::text AS vendor_type,
              l.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              COALESCE(SUM(CASE WHEN l.entry_type = 'commission_accrual' AND COALESCE(l.notes,'') NOT LIKE '[waived]%' THEN l.amount ELSE 0 END), 0)::float8 AS total_billed,
              COALESCE(-SUM(CASE WHEN l.entry_type = 'settlement_payment' THEN l.amount ELSE 0 END), 0)::float8 AS total_settled,
              COALESCE(MAX(b.outstanding), 0)::float8 AS arrears,
              MAX(CASE WHEN l.entry_type = 'settlement_payment' THEN l.created_at END) AS last_settlement_at
       FROM public.vendor_dues_ledger l
       LEFT JOIN public.vendor_outstanding_balance b
              ON b.vendor_type = l.vendor_type AND b.vendor_id = l.vendor_id
       WHERE 1=1 ${timeFilter}
       GROUP BY l.vendor_type, l.vendor_id
       ORDER BY arrears DESC NULLS LAST, total_billed DESC
       LIMIT 200`,
      params,
    );
    return result.rows;
  },

  async getById(id: string): Promise<CommissionRow | null> {
    return queryOne<CommissionRow>(
      `SELECT l.id,
              l.vendor_type::text AS vendor_type,
              l.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              ${VENDOR_CITY_SQL} AS vendor_city,
              l.transaction_id,
              t.appointment_id,
              l.entry_type::text AS entry_type,
              l.amount::float8 AS amount,
              l.balance_after::float8 AS balance_after,
              l.notes,
              ${STATUS_SQL} AS status,
              l.created_at
       FROM public.vendor_dues_ledger l
       LEFT JOIN public.transactions t ON t.id = l.transaction_id
       WHERE l.id = $1`,
      [id],
    );
  },

  async waive(id: string, reason: string, userId: string): Promise<void> {
    // Mark the row waived by prefixing the notes column. This is the v1 path
    // until a dedicated `status` column is added (cheap to migrate later).
    try {
      await query(
        `UPDATE public.vendor_dues_ledger
           SET notes = '[waived] ' || COALESCE(notes, '') || ' (by ' || $2::text || ': ' || $3 || ')'
         WHERE id = $1
           AND entry_type = 'commission_accrual'
           AND COALESCE(notes, '') NOT LIKE '[waived]%'`,
        [id, userId, reason],
      );
    } catch (e) { mapPgError(e); }
  },

  /**
   * Append a manual adjustment row to the dues ledger. Positive amount =
   * vendor owes more (debit); negative amount = vendor owes less (credit).
   * The new row's `balance_after` is the running snapshot.
   */
  async appendAdjustment(input: {
    vendor_type: string;
    vendor_id: string;
    /** Amount in INR (rupees). Positive = vendor owes (debit); negative = credit. */
    amount: number;
    reason: string;
    userId: string;
  }): Promise<string> {
    try {
      const inserted = await queryOne<{ id: string }>(
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
                'admin-adjust: ' || $4,
                $5
         RETURNING id`,
        [input.vendor_type, input.vendor_id, input.amount, input.reason, input.userId],
      );
      if (!inserted) throw new Error('Failed to append ledger adjustment');
      return inserted.id;
    } catch (e) { mapPgError(e); }
  },
};
