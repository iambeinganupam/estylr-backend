// ─────────────────────────────────────────────────────────────────────────────
// Admin Refunds — Repository
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { RefundListQuery } from './admin-refunds.schemas';

/**
 * A refund claimed for provider dispatch. `external_ref` is the original
 * settled transaction's gateway reference (Razorpay payment id) — NULL when
 * the appointment was never charged through the gateway (e.g. cash), in which
 * case the dispatcher records an error and skips it.
 */
export interface RefundDispatchRow {
  id: string;
  appointment_id: string;
  vendor_type: string;
  vendor_id: string;
  /** Refund amount in INR (rupees), NUMERIC(10,2). Use gateway_amount_paise for provider API calls. */
  amount: number;
  /** DB-computed: ROUND(amount * 100). Use directly for Razorpay/Stripe/Cashfree refund calls. */
  gateway_amount_paise: number;
  external_ref: string | null;
}

export interface RefundRow {
  id: string;
  appointment_id: string;
  customer_id: string;
  customer_email: string | null;
  customer_phone: string | null;
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  /** Refund amount in INR (rupees), NUMERIC(10,2). */
  amount: number;
  /** DB-computed: ROUND(amount * 100). Use for gateway API calls requiring integer paise. */
  gateway_amount_paise: number;
  currency: string;
  reason: string;
  status: string;
  resolved_by: string | null;
  resolved_note: string | null;
  resolved_at: string | null;
  provider_ref: string | null;
  created_at: string;
  updated_at: string;
}

const VENDOR_NAME_SQL = `
  CASE WHEN r.vendor_type = 'freelancer'
       THEN (SELECT business_name FROM public.freelancer_profiles WHERE id = r.vendor_id)
       ELSE (SELECT display_name  FROM public.salon_locations    WHERE id = r.vendor_id)
  END
`;

export const adminRefundsRepository = {
  async list(q: RefundListQuery): Promise<{ rows: RefundRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.status && q.status !== 'all') push('r.status = ?', q.status);
    if (q.vendor_id) push('r.vendor_id = ?', q.vendor_id);
    if (q.from)      push('r.created_at >= ?', q.from);
    if (q.to)        push('r.created_at <= ?', q.to);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(r.reason) LIKE ${p}
          OR LOWER(COALESCE(u.email,'')) LIKE ${p}
          OR COALESCE(u.phone_number,'') LIKE ${p})`,
      );
    }

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(
          `(r.created_at, r.id) < ($${params.length - 1}, $${params.length})`,
        );
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<RefundRow>(
      `SELECT r.id,
              r.appointment_id,
              r.customer_id,
              u.email AS customer_email,
              u.phone_number AS customer_phone,
              r.vendor_type::text AS vendor_type,
              r.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              r.amount::float8 AS amount,
              r.gateway_amount_paise,
              r.currency,
              r.reason,
              r.status::text AS status,
              r.resolved_by,
              r.resolved_note,
              r.resolved_at,
              r.provider_ref,
              r.created_at,
              r.updated_at
       FROM public.refund_requests r
       JOIN public.users u ON u.id = r.customer_id
       ${where}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<RefundRow | null> {
    return queryOne<RefundRow>(
      `SELECT r.id,
              r.appointment_id,
              r.customer_id,
              u.email AS customer_email,
              u.phone_number AS customer_phone,
              r.vendor_type::text AS vendor_type,
              r.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              r.amount::float8 AS amount,
              r.gateway_amount_paise,
              r.currency,
              r.reason,
              r.status::text AS status,
              r.resolved_by,
              r.resolved_note,
              r.resolved_at,
              r.provider_ref,
              r.created_at,
              r.updated_at
       FROM public.refund_requests r
       JOIN public.users u ON u.id = r.customer_id
       WHERE r.id = $1`,
      [id],
    );
  },

  async resolve(
    id: string,
    decision: 'approved' | 'rejected',
    note: string,
    actingUserId: string,
  ): Promise<void> {
    try {
      await query(
        `UPDATE public.refund_requests
           SET status = $2,
               resolved_by = $3,
               resolved_note = $4,
               resolved_at = NOW(),
               updated_at = NOW()
         WHERE id = $1
           AND status = 'pending'`,
        [id, decision, actingUserId, note],
      );
    } catch (e) { mapPgError(e); }
  },

  async createAdminInitiated(input: {
    appointment_id: string;
    customer_id: string;
    vendor_type: string;
    vendor_id: string;
    /** Amount in INR (rupees), NUMERIC(10,2). NOT paise. */
    amount: number;
    reason: string;
    actingUserId: string;
  }): Promise<RefundRow | null> {
    // Admin-initiated refunds are auto-approved (the initiator is the
    // approver). Provider call still happens via the downstream job.
    try {
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO public.refund_requests
           (appointment_id, customer_id, vendor_type, vendor_id,
            amount, reason, status, resolved_by, resolved_note, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, 'admin-initiated', NOW())
         RETURNING id`,
        [
          input.appointment_id, input.customer_id, input.vendor_type, input.vendor_id,
          input.amount, input.reason, input.actingUserId,
        ],
      );
      return inserted ? this.getById(inserted.id) : null;
    } catch (e) { mapPgError(e); }
  },

  async markCompleted(id: string, providerRef: string, client?: PoolClient): Promise<void> {
    // Stamp last_attempt_at on success too. Note: provider_attempts counts only
    // FAILED provider attempts — do NOT increment it here (this path is shared
    // with the manual admin-completion endpoint, where no provider call was made).
    //
    // Money-safety: ALSO stamp the linked transaction as 'refunded' atomically,
    // closing the double-refund window. Without it the refund_request flips to
    // 'completed' but transactions.status stays 'completed', so a super-admin
    // PATCH /admin/transactions/:id/refund (which proceeds on 'completed') would
    // issue a SECOND provider refund on the same charge. The transaction stamp
    // mirrors payments.repository.applyRefund exactly (status='refunded',
    // refund_amount in rupees, refund_reason, refunded_at) so both refund paths
    // converge on identical transaction state. The status='completed' guard on
    // the transaction UPDATE keeps it idempotent and safe for the cash-booking
    // manual-completion path too (cash bookings have a completed transaction).
    const run = async (c: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => {
      await c.query(
        `UPDATE public.refund_requests
           SET status = 'completed',
               provider_ref = $2,
               last_attempt_at = NOW(),
               updated_at = NOW()
         WHERE id = $1 AND status = 'approved'`,
        [id, providerRef],
      );
      await c.query(
        // r.amount is already NUMERIC(10,2) in rupees — no conversion needed.
        `UPDATE public.transactions t
            SET status = 'refunded',
                refunded_at = NOW(),
                refund_amount = r.amount,
                refund_reason = r.reason,
                updated_at = NOW()
           FROM public.refund_requests r
          WHERE r.id = $1
            AND t.appointment_id = r.appointment_id
            AND t.status = 'completed'`,
        [id],
      );
    };
    try {
      // A caller-supplied client (e.g. integration-db tests under withRollback)
      // already owns a transaction; otherwise open our own so both UPDATEs commit
      // atomically.
      if (client) {
        await run(client);
      } else {
        await withTransaction((c) => run(c));
      }
    } catch (e) { mapPgError(e); }
  },

  /**
   * Claim up to `batch` approved-but-unsettled refunds for provider dispatch,
   * using FOR UPDATE SKIP LOCKED so concurrent workers don't double-process.
   * Joins the original settled transaction (by appointment_id) to surface its
   * gateway `external_ref`. Must run inside a transaction (pass the client).
   */
  async claimRefundsForDispatch(
    batch: number,
    maxAttempts: number,
    client: PoolClient,
  ): Promise<RefundDispatchRow[]> {
    const { rows } = await client.query<RefundDispatchRow>(
      // Assumption: one completed gateway transaction per appointment. The
      // correlated subquery picks the MOST-RECENT completed txn's external_ref.
      // Partial-refund / re-payment scenarios (multiple completed txns per
      // appointment) would need a stored transaction_id on the refund row to
      // target the exact charge instead of "latest wins".
      `SELECT r.id,
              r.appointment_id,
              r.vendor_type::text AS vendor_type,
              r.vendor_id,
              r.amount::float8 AS amount,
              r.gateway_amount_paise,
              (SELECT t.external_ref
                 FROM public.transactions t
                WHERE t.appointment_id = r.appointment_id
                  AND t.status = 'completed'
                  AND t.external_ref IS NOT NULL
                ORDER BY t.created_at DESC
                LIMIT 1) AS external_ref
         FROM public.refund_requests r
        WHERE r.status = 'approved'
          AND r.provider_ref IS NULL
          AND r.provider_attempts < $2
          -- Only auto-dispatch refunds that HAVE a resolvable gateway charge.
          -- Cash/UPI refunds (no completed external_ref txn) are excluded here
          -- so they never burn provider_attempts; they stay approved for an
          -- admin to complete manually via PATCH /admin/refunds/:id/complete.
          AND EXISTS (
            SELECT 1 FROM public.transactions t
             WHERE t.appointment_id = r.appointment_id
               AND t.status = 'completed'
               AND t.external_ref IS NOT NULL
          )
        ORDER BY r.created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batch, maxAttempts],
    );
    return rows;
  },

  /**
   * Record a failed provider dispatch attempt: bump the counter, stamp the
   * time, store the error. Leaves status = approved so the job retries later.
   */
  async recordDispatchAttempt(refundId: string, error: string): Promise<void> {
    try {
      await query(
        `UPDATE public.refund_requests
           SET provider_attempts = provider_attempts + 1,
               last_attempt_at = NOW(),
               last_provider_error = $2,
               updated_at = NOW()
         WHERE id = $1`,
        [refundId, error],
      );
    } catch (e) { mapPgError(e); }
  },
};
