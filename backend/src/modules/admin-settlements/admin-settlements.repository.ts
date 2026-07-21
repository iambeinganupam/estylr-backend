// ─────────────────────────────────────────────────────────────────────────────
// Admin Settlements — Repository
// ─────────────────────────────────────────────────────────────────────────────
// Settlements live in `vendor_dues_ledger` with entry_type='settlement_payment'.
// `amount` is negative there (the vendor reduced their dues by paying us);
// we flip the sign for the admin display.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { decodeCursor } from '../../lib/pagination';
import type {
  SettlementListQuery,
  SettlementSummaryQuery,
} from './admin-settlements.schemas';

export interface SettlementRow {
  id: string;
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  vendor_city: string | null;
  /** Settlement amount in INR (rupees). Positive value (ledger amount negated). */
  amount: number;
  /** Vendor's outstanding balance after this settlement, in INR (rupees). */
  balance_after: number;
  external_ref: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_by_email: string | null;
  created_at: string;
}

export interface SettlementSummary {
  total_settled: number;
  total_outstanding: number;
  vendors_settled: number;
  vendors_outstanding: number;
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

export const adminSettlementsRepository = {
  async list(q: SettlementListQuery): Promise<{ rows: SettlementRow[]; hasMore: boolean }> {
    const conditions: string[] = ["l.entry_type = 'settlement_payment'"];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.vendor_id)   push('l.vendor_id = ?', q.vendor_id);
    if (q.vendor_type) push('l.vendor_type = ?', q.vendor_type);
    if (q.from)        push('l.created_at >= ?', q.from);
    if (q.to)          push('l.created_at <= ?', q.to);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(`(LOWER(COALESCE(l.external_ref, '')) LIKE ${p} OR LOWER(COALESCE(l.notes, '')) LIKE ${p})`);
    }
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(`(l.created_at, l.id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<SettlementRow>(
      `SELECT l.id,
              l.vendor_type::text AS vendor_type,
              l.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              ${VENDOR_CITY_SQL} AS vendor_city,
              (-l.amount)::float8 AS amount,
              l.balance_after::float8 AS balance_after,
              l.external_ref,
              l.notes,
              l.created_by AS recorded_by,
              u.email AS recorded_by_email,
              l.created_at
       FROM public.vendor_dues_ledger l
       LEFT JOIN public.users u ON u.id = l.created_by
       ${where}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<SettlementRow | null> {
    return queryOne<SettlementRow>(
      `SELECT l.id,
              l.vendor_type::text AS vendor_type,
              l.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              ${VENDOR_CITY_SQL} AS vendor_city,
              (-l.amount)::float8 AS amount,
              l.balance_after::float8 AS balance_after,
              l.external_ref,
              l.notes,
              l.created_by AS recorded_by,
              u.email AS recorded_by_email,
              l.created_at
       FROM public.vendor_dues_ledger l
       LEFT JOIN public.users u ON u.id = l.created_by
       WHERE l.id = $1 AND l.entry_type = 'settlement_payment'`,
      [id],
    );
  },

  async getSummary(q: SettlementSummaryQuery): Promise<SettlementSummary> {
    const params: unknown[] = [];
    let timeFilter = '';
    if (q.from) { params.push(q.from); timeFilter += ` AND l.created_at >= $${params.length}`; }
    if (q.to)   { params.push(q.to);   timeFilter += ` AND l.created_at <= $${params.length}`; }

    const settled = await queryOne<{ amount: number; vendors: number }>(
      `SELECT COALESCE(-SUM(amount), 0)::float8 AS amount,
              COUNT(DISTINCT (vendor_type, vendor_id))::int AS vendors
       FROM public.vendor_dues_ledger l
       WHERE entry_type = 'settlement_payment'${timeFilter}`,
      params,
    );

    const outstanding = await queryOne<{ amount: number; vendors: number }>(
      `SELECT COALESCE(SUM(GREATEST(outstanding, 0)), 0)::float8 AS amount,
              COUNT(*) FILTER (WHERE outstanding > 0)::int AS vendors
       FROM public.vendor_outstanding_balance`,
    );

    return {
      total_settled:     settled?.amount ?? 0,
      total_outstanding: outstanding?.amount ?? 0,
      vendors_settled:   settled?.vendors ?? 0,
      vendors_outstanding: outstanding?.vendors ?? 0,
    };
  },
};
