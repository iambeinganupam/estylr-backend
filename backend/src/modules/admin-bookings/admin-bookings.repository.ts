// ─────────────────────────────────────────────────────────────────────────────
// Admin Bookings — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { BookingListQuery } from './admin-bookings.schemas';

export interface BookingRow {
  id: string;
  short_id: string;
  customer_id: string;
  customer_email: string | null;
  customer_phone: string | null;
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  vendor_city: string | null;
  staff_member_id: string | null;
  staff_name: string | null;
  start_time: string;
  end_time: string;
  status: string;
  /** Gross booking amount in INR (rupees). Alias of transactions.amount. */
  gross_amount: number;
  /** Platform commission in INR (rupees). Alias of transactions.platform_fee. */
  platform_fee: number;
  payment_method: string | null;
  service_count: number;
  created_at: string;
}

export interface BookingDetail extends BookingRow {
  intent_id: string | null;
  completion_note: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  otp_verified_at: string | null;
  line_items: Array<{ service_id: string; service_name: string; price: number; duration_minutes: number }>;
  transaction: {
    id: string;
    status: string;
    payment_method: string | null;
    /** Transaction amount in INR (rupees). */
    amount: number;
    /** Platform commission in INR (rupees). */
    platform_fee: number;
    /** Vendor payout in INR (rupees). */
    vendor_payout: number;
    external_ref: string | null;
    refunded_at: string | null;
  } | null;
}

const VENDOR_NAME_SQL = `
  CASE WHEN a.vendor_type = 'freelancer'
       THEN (SELECT business_name FROM public.freelancer_profiles WHERE id = a.vendor_id)
       ELSE (SELECT display_name  FROM public.salon_locations    WHERE id = a.vendor_id)
  END
`;

const VENDOR_CITY_SQL = `
  CASE WHEN a.vendor_type = 'freelancer'
       THEN (SELECT city FROM public.freelancer_profiles WHERE id = a.vendor_id)
       ELSE (SELECT city FROM public.salon_locations    WHERE id = a.vendor_id)
  END
`;

export const adminBookingsRepository = {
  async list(q: BookingListQuery): Promise<{ rows: BookingRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.status && q.status !== 'all') push('a.status = ?', q.status);
    if (q.vendor_id)   push('a.vendor_id = ?', q.vendor_id);
    if (q.vendor_type) push('a.vendor_type = ?', q.vendor_type);
    if (q.customer_id) push('a.customer_id = ?', q.customer_id);
    if (q.from)        push('a.start_time >= ?', q.from);
    if (q.to)          push('a.start_time <= ?', q.to);
    if (q.payment_method && q.payment_method !== 'all') push('t.payment_method = ?', q.payment_method);
    if (q.city) {
      params.push(`%${q.city.toLowerCase()}%`);
      conditions.push(`LOWER(${VENDOR_CITY_SQL}) LIKE $${params.length}`);
    }
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(SUBSTRING(a.id::text, 1, 8)) LIKE ${p}
          OR LOWER(COALESCE(u.email,'')) LIKE ${p}
          OR COALESCE(u.phone_number,'') LIKE ${p})`,
      );
    }

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(
          `(a.created_at, a.id) < ($${params.length - 1}, $${params.length})`,
        );
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<BookingRow>(
      `SELECT a.id,
              SUBSTRING(a.id::text, 1, 8) AS short_id,
              a.customer_id,
              u.email   AS customer_email,
              u.phone_number AS customer_phone,
              a.vendor_type,
              a.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              ${VENDOR_CITY_SQL} AS vendor_city,
              a.staff_member_id,
              (SELECT COALESCE(cp.first_name || ' ' || cp.last_name, su.email)
               FROM public.staff_members sm
               JOIN public.users su ON su.id = sm.user_id
               LEFT JOIN public.customer_profiles cp ON cp.user_id = su.id
               WHERE sm.id = a.staff_member_id) AS staff_name,
              a.start_time,
              a.end_time,
              a.status::text AS status,
              COALESCE(t.amount, 0)::float8 AS gross_amount,
              COALESCE(t.platform_fee, 0)::float8 AS platform_fee,
              t.payment_method::text AS payment_method,
              (SELECT COUNT(*)::int FROM public.appointment_line_items WHERE appointment_id = a.id) AS service_count,
              a.created_at
       FROM public.appointments a
       JOIN public.users u ON u.id = a.customer_id
       LEFT JOIN public.transactions t ON t.appointment_id = a.id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<BookingDetail | null> {
    const head = await queryOne<BookingRow & { intent_id: string | null; completion_note: string | null; cancellation_reason: string | null; cancelled_by: string | null; otp_verified_at: string | null }>(
      `SELECT a.id,
              SUBSTRING(a.id::text, 1, 8) AS short_id,
              a.customer_id,
              u.email   AS customer_email,
              u.phone_number AS customer_phone,
              a.vendor_type,
              a.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              ${VENDOR_CITY_SQL} AS vendor_city,
              a.staff_member_id,
              (SELECT COALESCE(cp.first_name || ' ' || cp.last_name, su.email)
               FROM public.staff_members sm
               JOIN public.users su ON su.id = sm.user_id
               LEFT JOIN public.customer_profiles cp ON cp.user_id = su.id
               WHERE sm.id = a.staff_member_id) AS staff_name,
              a.start_time,
              a.end_time,
              a.status::text AS status,
              COALESCE(t.amount, 0)::float8 AS gross_amount,
              COALESCE(t.platform_fee, 0)::float8 AS platform_fee,
              t.payment_method::text AS payment_method,
              (SELECT COUNT(*)::int FROM public.appointment_line_items WHERE appointment_id = a.id) AS service_count,
              a.intent_id,
              a.completion_note,
              a.cancellation_reason,
              a.cancelled_by,
              a.otp_verified_at,
              a.created_at
       FROM public.appointments a
       JOIN public.users u ON u.id = a.customer_id
       LEFT JOIN public.transactions t ON t.appointment_id = a.id
       WHERE a.id = $1`,
      [id],
    );
    if (!head) return null;

    const items = await query<{ service_id: string; service_name: string; price: number; duration_minutes: number }>(
      `SELECT service_id, service_name,
              locked_price::float8 AS price,
              duration_minutes
       FROM public.appointment_line_items
       WHERE appointment_id = $1
       ORDER BY created_at ASC`,
      [id],
    );

    const tx = await queryOne<NonNullable<BookingDetail['transaction']>>(
      `SELECT id,
              status::text AS status,
              payment_method::text AS payment_method,
              amount::float8 AS amount,
              platform_fee::float8 AS platform_fee,
              vendor_payout::float8 AS vendor_payout,
              external_ref,
              refunded_at
       FROM public.transactions
       WHERE appointment_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [id],
    );

    return { ...head, line_items: items.rows, transaction: tx };
  },

  async update(
    id: string,
    patch: { status?: string; completion_note?: string | null; cancellation_reason?: string | null },
    actingUserId: string,
  ): Promise<void> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    if (patch.status !== undefined) {
      params.push(patch.status); sets.push(`status = $${params.length}::appointment_status`);
    }
    if (patch.completion_note !== undefined) {
      params.push(patch.completion_note); sets.push(`completion_note = $${params.length}`);
    }
    if (patch.cancellation_reason !== undefined) {
      params.push(patch.cancellation_reason); sets.push(`cancellation_reason = $${params.length}`);
      // Stamp who cancelled when admin force-cancels.
      if (patch.status === 'cancelled') {
        params.push(actingUserId); sets.push(`cancelled_by = $${params.length}`);
      }
    }
    if (sets.length === 1) return;
    params.push(id);
    try {
      await query(`UPDATE public.appointments SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    } catch (e) { mapPgError(e); }
  },
};
