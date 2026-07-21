// ─────────────────────────────────────────────────────────────────────────────
// Finance Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne, withTransaction } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import type { VendorType, LedgerEntryType } from '../../lib/constants';

export interface LedgerEntryRow {
  id: string;
  vendor_type: VendorType;
  vendor_id: string;
  transaction_id: string | null;
  entry_type: LedgerEntryType;
  amount: string;
  balance_after: string;
  notes: string | null;
  external_ref: string | null;
  created_by: string | null;
  created_at: string;
}

export const financeRepository = {
  async listTransactions(vendorId: string, filters: {
    fromDate?: string; toDate?: string; status?: string; limit: number;
  }) {
    const conditions: string[] = ['t.vendor_id = $1'];
    const params: unknown[] = [vendorId];
    let paramIdx = 2;

    if (filters.fromDate) { conditions.push(`t.created_at >= $${paramIdx++}::date`); params.push(filters.fromDate); }
    if (filters.toDate) { conditions.push(`t.created_at < ($${paramIdx++}::date + interval '1 day')`); params.push(filters.toDate); }
    if (filters.status) {
      // 'settled' is the API alias for the DB enum value 'completed'.
      const dbStatus = filters.status === 'settled' ? 'completed' : filters.status;
      conditions.push(`t.status = $${paramIdx++}`);
      params.push(dbStatus);
    }

    const result = await query(
      `SELECT t.id, t.appointment_id, t.vendor_id, t.currency, t.payment_method,
              t.external_ref, t.gateway_response, t.refund_amount, t.refund_reason,
              t.refunded_at, t.created_at, t.updated_at,
              t.amount        AS gross_amount,
              t.platform_fee  AS platform_fee,
              t.vendor_payout AS net_payout,
              -- API contract uses 'settled' as the public name for a fully-paid
              -- transaction; DB enum stores 'completed'. Translate at the boundary.
              CASE WHEN t.status = 'completed' THEN 'settled' ELSE t.status::text END AS status,
              COALESCE(li.service_names, ARRAY[]::text[]) AS service_names
       FROM public.transactions t
       LEFT JOIN LATERAL (
         SELECT array_agg(li.service_name ORDER BY li.created_at) AS service_names
         FROM public.appointment_line_items li
         WHERE li.appointment_id = t.appointment_id
       ) li ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.created_at DESC LIMIT $${paramIdx}`,
      [...params, filters.limit],
    );
    return result.rows;
  },

  async getTransactionById(txId: string) {
    return queryOne(
      `SELECT t.id, t.appointment_id, t.vendor_id, t.currency, t.payment_method,
              t.external_ref, t.gateway_response, t.refund_amount, t.refund_reason,
              t.refunded_at, t.created_at, t.updated_at,
              t.amount        AS gross_amount,
              t.platform_fee  AS platform_fee,
              t.vendor_payout AS net_payout,
              CASE WHEN t.status = 'completed' THEN 'settled' ELSE t.status::text END AS status,
              a.start_time, a.end_time, a.status AS appointment_status
       FROM public.transactions t
       LEFT JOIN public.appointments a ON t.appointment_id = a.id
       WHERE t.id = $1`,
      [txId],
    );
  },

  async createTransaction(data: {
    vendorId: string; appointmentId: string; amount: number; currency: string;
    status: string; paymentMethod: string;
    subtotal: number; taxAmount: number; taxRate: number;
    /** Platform commission cut (defaults to 0 — service layer computes it). */
    platformFee?: number;
    /** Net amount the vendor keeps (= amount − platformFee). */
    vendorPayout?: number;
    externalRef?: string | null; gatewayResponse?: string | null;
  }) {
    try {
      return await queryOne(
        `INSERT INTO public.transactions
         (vendor_id, appointment_id, amount, currency, status, payment_method,
          subtotal, tax_amount, tax_rate, bill_number,
          platform_fee, vendor_payout,
          external_ref, gateway_response)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 'INV-' || lpad(nextval('public.invoice_seq')::text, 8, '0'),
                 $10, $11, $12, $13)
         RETURNING *`,
        [data.vendorId, data.appointmentId, data.amount, data.currency,
         data.status, data.paymentMethod,
         data.subtotal, data.taxAmount, data.taxRate,
         data.platformFee ?? 0, data.vendorPayout ?? data.amount,
         data.externalRef ?? null, data.gatewayResponse ?? null],
      );
    } catch (e) { mapPgError(e); }
  },

  async getCompletedTransactionByAppointment(appointmentId: string) {
    return queryOne(
      `SELECT * FROM public.transactions
       WHERE appointment_id = $1 AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`,
      [appointmentId],
    );
  },

  /**
   * Full denormalised invoice payload for a transaction. The shape is uniform
   * across customer types — walk-in, subscriber, or Kshuri-direct — with the
   * customer block resolved from `users` when `customer_id` is set, otherwise
   * from the appointment's `customer_name` / `customer_phone` snapshot.
   * Future delivery channels (email/SMS) read from this same response.
   */
  async getBillByTransactionId(transactionId: string) {
    return queryOne(
      `SELECT
         t.id                  AS transaction_id,
         t.bill_number,
         t.amount              AS total,
         t.subtotal,
         t.tax_amount,
         t.tax_rate,
         t.currency,
         t.payment_method,
         t.status,
         t.created_at          AS issued_at,
         t.vendor_id,

         -- Business / vendor block (from business_accounts via salon_locations
         -- if the appointment is salon-scoped, else direct on freelancer)
         jsonb_build_object(
           'name',          COALESCE(ba.brand_name, ba.legal_business_name, sl.display_name),
           'legal_name',    ba.legal_business_name,
           'gstin',         ba.gstin,
           'address',       NULLIF(
                              concat_ws(', ',
                                NULLIF(sl.address_line1, ''),
                                NULLIF(sl.address_line2, ''),
                                NULLIF(sl.city, ''),
                                NULLIF(sl.state, ''),
                                NULLIF(sl.postal_code, '')
                              ), ''
                            ),
           'phone',         COALESCE(sl.contact_phone, ba.contact_phone),
           'email',         COALESCE(sl.contact_email, ba.contact_email),
           'logo_url',      COALESCE(sl.logo_url, ba.logo_url)
         ) AS business,

         -- Customer block (resolved for both walk-in and registered)
         jsonb_build_object(
           'name',     COALESCE(
                         NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
                         a.customer_name,
                         u.email,
                         'Guest'
                       ),
           'phone',    COALESCE(a.customer_phone, u.phone_number),
           'email',    u.email,
           'customer_type', CASE
             WHEN a.customer_id IS NOT NULL THEN 'registered'
             ELSE 'walkin'
           END,
           'is_registered', a.customer_id IS NOT NULL
         ) AS customer,

         -- Appointment + line items (frozen prices)
         a.id                  AS appointment_id,
         a.start_time,
         a.end_time,
         a.booking_type,
         a.notes               AS appointment_notes,
         COALESCE(li.items, '[]'::jsonb) AS line_items
       FROM public.transactions t
       LEFT JOIN public.appointments a ON a.id = t.appointment_id
       LEFT JOIN public.users u        ON u.id = a.customer_id
       LEFT JOIN public.salon_locations sl ON sl.id = t.vendor_id
       LEFT JOIN public.business_accounts ba ON ba.id = COALESCE(sl.business_account_id, t.vendor_id)
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
                  jsonb_build_object(
                    'service_id',       li.service_id,
                    'service_name',     li.service_name,
                    'duration_minutes', li.duration_minutes,
                    'price',            li.locked_price
                  ) ORDER BY li.created_at
                ) AS items
         FROM public.appointment_line_items li
         WHERE li.appointment_id = a.id
       ) li ON TRUE
       WHERE t.id = $1`,
      [transactionId],
    );
  },

  async getRevenueSummary(vendorId: string) {
    return queryOne(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0)                     AS total_revenue,
         COUNT(*) FILTER (WHERE status IN ('completed', 'pending', 'refunded'))                        AS total_bookings,
         COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= date_trunc('month', NOW()) THEN amount ELSE 0 END), 0) AS month_revenue,
         COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= date_trunc('week', NOW()) THEN amount ELSE 0 END), 0)  AS week_revenue,
         CASE WHEN COUNT(*) FILTER (WHERE status = 'completed') > 0
              THEN COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0)
                   / COUNT(*) FILTER (WHERE status = 'completed')
              ELSE 0 END                                                                               AS avg_per_booking,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0)                       AS pending_amount,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
         COUNT(*) FILTER (WHERE status = 'pending')   AS pending_count,
         COUNT(*) FILTER (WHERE status = 'refunded')  AS refunded_count,
         'INR'                                                                                         AS currency
       FROM public.transactions WHERE vendor_id = $1`,
      [vendorId],
    );
  },

  async getPendingPayouts(businessId: string, periodStart: string, periodEnd: string) {
    const result = await query(
      `SELECT sm.id AS staff_id, u.email AS staff_name, sm.commission_percentage,
              COUNT(a.id)::int AS appointments_count,
              COALESCE(SUM(t.amount), 0) AS gross_generated,
              COALESCE(SUM(t.amount * sm.commission_percentage / 100), 0) AS commission_owed
       FROM public.staff_members sm
       JOIN public.users u ON sm.user_id = u.id
       LEFT JOIN public.appointments a ON a.staff_member_id = sm.id
         AND a.status = 'completed' AND a.start_time >= $2::date AND a.start_time < ($3::date + interval '1 day')
       LEFT JOIN public.transactions t ON t.appointment_id = a.id AND t.status = 'completed'
       WHERE sm.employer_id = $1 AND sm.is_active = TRUE
       GROUP BY sm.id, u.email, sm.commission_percentage
       ORDER BY commission_owed DESC`,
      [businessId, periodStart, periodEnd],
    );
    return result.rows;
  },

  async createPayoutBatch(businessId: string, staffIds: string[], periodStart: string, periodEnd: string) {
    const results = [];
    for (const staffId of staffIds) {
      try {
        const row = await queryOne(
          `INSERT INTO public.staff_payouts (business_id, staff_member_id, period_start, period_end, status, amount)
           SELECT $1, $2, $3, $4, 'processing',
                  COALESCE(SUM(t.amount * sm.commission_percentage / 100), 0)
           FROM public.staff_members sm
           LEFT JOIN public.appointments a ON a.staff_member_id = sm.id
             AND a.status = 'completed' AND a.start_time >= $3::date AND a.start_time < ($4::date + interval '1 day')
           LEFT JOIN public.transactions t ON t.appointment_id = a.id AND t.status = 'completed'
           WHERE sm.id = $2
           GROUP BY sm.id
           RETURNING *`,
          [businessId, staffId, periodStart, periodEnd],
        );
        if (row) results.push(row);
      } catch (e) { mapPgError(e); }
    }
    return results;
  },

  async getSettlements(vendorId: string) {
    const result = await query(
      `SELECT * FROM public.staff_payouts
       WHERE business_id = $1
       ORDER BY created_at DESC LIMIT 100`,
      [vendorId],
    );
    return result.rows;
  },

  async getBankAccount(vendorId: string) {
    return queryOne(
      `SELECT * FROM public.bank_accounts WHERE vendor_id = $1 AND is_primary = TRUE`,
      [vendorId],
    );
  },

  async upsertBankAccount(vendorId: string, data: {
    bankName: string; accountNumber: string; ifscCode: string;
    accountHolderName: string; isPrimary: boolean;
  }) {
    try {
      return await queryOne(
        `INSERT INTO public.bank_accounts (vendor_id, bank_name, account_number, ifsc_code, account_holder_name, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (vendor_id) WHERE is_primary = TRUE
         DO UPDATE SET bank_name = $2, account_number = $3, ifsc_code = $4,
           account_holder_name = $5, updated_at = NOW()
         RETURNING *`,
        [vendorId, data.bankName, data.accountNumber, data.ifscCode, data.accountHolderName, data.isPrimary],
      );
    } catch (e) { mapPgError(e); }
  },

  async getExportData(vendorId: string, type: string, startDate: string, endDate: string) {
    if (type === 'transactions') {
      const result = await query(
        `SELECT id, appointment_id, amount, currency, status, created_at
         FROM public.transactions
         WHERE vendor_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
         ORDER BY created_at`,
        [vendorId, startDate, endDate],
      );
      return result.rows;
    }
    if (type === 'payout_history') {
      const result = await query(
        `SELECT * FROM public.staff_payouts
         WHERE business_id = $1 AND period_start >= $2::date AND period_end <= $3::date
         ORDER BY created_at`,
        [vendorId, startDate, endDate],
      );
      return result.rows;
    }
    // tax_summary
    return [];
  },

  // ── Vendor dues ledger ────────────────────────────────────────────────────
  // The ledger is append-only; each row carries a `balance_after` snapshot
  // so the "what do I owe?" query is a single LIMIT 1 scan against the view.
  //
  // Race safety: appendDuesLedgerEntry takes a per-vendor xact-scoped
  // advisory lock so concurrent commission accruals can't both read the
  // same prior balance and double-write. The lock is keyed on a stable
  // hash of (vendor_type, vendor_id) and released on COMMIT/ROLLBACK.

  async appendDuesLedgerEntry(entry: {
    vendorType: VendorType;
    vendorId: string;
    transactionId: string | null;
    entryType: LedgerEntryType;
    /** Signed delta: positive = vendor owes platform, negative = vendor paid platform. */
    amount: number;
    notes?: string | null;
    externalRef?: string | null;
    createdBy?: string | null;
  }): Promise<LedgerEntryRow> {
    return withTransaction(async (client) => {
      // Per-vendor advisory lock — serialises all writes for this vendor
      // without blocking other vendors. Released automatically on commit.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`,
        [entry.vendorType, entry.vendorId],
      );

      const prev = await client.query<{ balance_after: string }>(
        `SELECT balance_after FROM public.vendor_dues_ledger
         WHERE vendor_type = $1 AND vendor_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [entry.vendorType, entry.vendorId],
      );
      const prevBalance = prev.rows[0] ? Number(prev.rows[0].balance_after) : 0;
      const newBalance = +(prevBalance + entry.amount).toFixed(2);

      const { rows } = await client.query<LedgerEntryRow>(
        `INSERT INTO public.vendor_dues_ledger
         (vendor_type, vendor_id, transaction_id, entry_type, amount, balance_after, notes, external_ref, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          entry.vendorType,
          entry.vendorId,
          entry.transactionId,
          entry.entryType,
          entry.amount,
          newBalance,
          entry.notes ?? null,
          entry.externalRef ?? null,
          entry.createdBy ?? null,
        ],
      );
      // INSERT … RETURNING * always yields exactly one row when it succeeds;
      // pg would have thrown otherwise. Cast keeps the narrowed type clean.
      return rows[0]!;
    });
  },

  async getOutstandingBalance(vendorType: VendorType, vendorId: string): Promise<number> {
    const row = await queryOne<{ outstanding: string | null }>(
      `SELECT outstanding FROM public.vendor_outstanding_balance
       WHERE vendor_type = $1 AND vendor_id = $2`,
      [vendorType, vendorId],
    );
    return row ? Number(row.outstanding) : 0;
  },

  async listLedgerEntries(
    vendorType: VendorType,
    vendorId: string,
    limit: number = 50,
  ): Promise<LedgerEntryRow[]> {
    const result = await query<LedgerEntryRow>(
      `SELECT * FROM public.vendor_dues_ledger
       WHERE vendor_type = $1 AND vendor_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [vendorType, vendorId, limit],
    );
    return result.rows;
  },

  /**
   * Lightweight read of the vendor's UPI identity for QR generation.
   *
   * For salon vendors, `vendor_id` on appointments may be either the
   * business_account_id (walk-ins / legacy intents) or the salon_location_id
   * (multi-location flows). The CTE below resolves both shapes to the
   * canonical business_account, then reads the UPI fields from there.
   *
   * Returns the venue's display_name as a fallback for `payee_name`.
   */
  async getVendorUpiProfile(
    vendorType: VendorType,
    vendorId: string,
  ): Promise<{ upi_id: string | null; upi_display_name: string | null; display_name: string } | null> {
    if (vendorType === 'salon_location') {
      return queryOne(
        `WITH target AS (
           -- Caller passed a salon_locations.id → resolve up to its parent BA.
           SELECT business_account_id AS ba_id, display_name FROM public.salon_locations
           WHERE id = $1
           UNION ALL
           -- Caller passed a business_accounts.id directly (walk-in path).
           SELECT id AS ba_id,
                  COALESCE(brand_name, legal_business_name) AS display_name
           FROM public.business_accounts
           WHERE id = $1
         )
         SELECT ba.upi_id,
                ba.upi_display_name,
                COALESCE(t.display_name, ba.brand_name, ba.legal_business_name, 'Salon') AS display_name
         FROM target t
         JOIN public.business_accounts ba ON ba.id = t.ba_id
         LIMIT 1`,
        [vendorId],
      );
    }
    return queryOne(
      `SELECT upi_id, upi_display_name, display_name
       FROM public.freelancer_profiles
       WHERE id = $1`,
      [vendorId],
    );
  },

  async getLastSettlementAt(
    vendorType: VendorType,
    vendorId: string,
  ): Promise<string | null> {
    const row = await queryOne<{ created_at: string }>(
      `SELECT created_at FROM public.vendor_dues_ledger
       WHERE vendor_type = $1 AND vendor_id = $2 AND entry_type = 'settlement_payment'
       ORDER BY created_at DESC LIMIT 1`,
      [vendorType, vendorId],
    );
    return row?.created_at ?? null;
  },

  async findTransactionOwner(id: string): Promise<{ vendor_id: string } | null> {
    return queryOne<{ vendor_id: string }>(
      `SELECT vendor_id FROM public.transactions WHERE id = $1`,
      [id],
    );
  },
};
