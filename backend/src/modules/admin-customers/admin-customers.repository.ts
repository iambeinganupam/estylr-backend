// ─────────────────────────────────────────────────────────────────────────────
// Admin Customers — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { CustomerListQuery } from './admin-customers.schemas';

export interface CustomerRow {
  id: string;
  email: string | null;
  phone_number: string | null;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
  total_bookings: number;
  lifetime_spend_inr: number;
  last_booking_at: string | null;
  last_booking_city: string | null;
  created_at: string;
}

export const adminCustomersRepository = {
  async list(q: CustomerListQuery): Promise<{ rows: CustomerRow[]; hasMore: boolean }> {
    const conditions: string[] = ["u.role = 'customer'"];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.is_active !== undefined)  push('u.is_active = ?', q.is_active);
    if (q.joined_from)              push('u.created_at >= ?', q.joined_from);
    if (q.joined_to)                push('u.created_at <= ?', q.joined_to);
    if (q.has_bookings === true)    conditions.push('agg.total_bookings > 0');
    if (q.has_bookings === false)   conditions.push('COALESCE(agg.total_bookings, 0) = 0');
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(COALESCE(u.email,'')) LIKE ${p}
          OR COALESCE(u.phone_number,'') LIKE ${p}
          OR LOWER(COALESCE(cp.first_name,'')) LIKE ${p}
          OR LOWER(COALESCE(cp.last_name,'')) LIKE ${p})`,
      );
    }

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(
          `(u.created_at, u.id) < ($${params.length - 1}, $${params.length})`,
        );
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<CustomerRow>(
      `SELECT u.id,
              u.email,
              u.phone_number,
              cp.first_name,
              cp.last_name,
              u.is_active,
              COALESCE(agg.total_bookings, 0) AS total_bookings,
              COALESCE(agg.lifetime_spend_inr, 0)::float8 AS lifetime_spend_inr,
              agg.last_booking_at,
              NULL::text AS last_booking_city,
              u.created_at
       FROM public.users u
       LEFT JOIN public.customer_profiles cp ON cp.user_id = u.id
       LEFT JOIN (
         SELECT a.customer_id,
                COUNT(*)::int AS total_bookings,
                COALESCE(SUM(t.amount), 0) AS lifetime_spend_inr,
                MAX(a.start_time) AS last_booking_at
         FROM public.appointments a
         LEFT JOIN public.transactions t
                ON t.appointment_id = a.id AND t.status = 'completed'
         GROUP BY a.customer_id
       ) agg ON agg.customer_id = u.id
       ${where}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<CustomerRow | null> {
    return queryOne<CustomerRow>(
      `SELECT u.id,
              u.email,
              u.phone_number,
              cp.first_name,
              cp.last_name,
              u.is_active,
              COALESCE(agg.total_bookings, 0) AS total_bookings,
              COALESCE(agg.lifetime_spend_inr, 0)::float8 AS lifetime_spend_inr,
              agg.last_booking_at,
              NULL::text AS last_booking_city,
              u.created_at
       FROM public.users u
       LEFT JOIN public.customer_profiles cp ON cp.user_id = u.id
       LEFT JOIN (
         SELECT a.customer_id,
                COUNT(*)::int AS total_bookings,
                COALESCE(SUM(t.amount), 0) AS lifetime_spend_inr,
                MAX(a.start_time) AS last_booking_at
         FROM public.appointments a
         LEFT JOIN public.transactions t
                ON t.appointment_id = a.id AND t.status = 'completed'
         GROUP BY a.customer_id
       ) agg ON agg.customer_id = u.id
       WHERE u.id = $1 AND u.role = 'customer'`,
      [id],
    );
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    try {
      await query(
        `UPDATE public.users
           SET is_active = $1,
               refresh_token_version = CASE WHEN $1 = FALSE THEN refresh_token_version + 1 ELSE refresh_token_version END,
               updated_at = NOW()
         WHERE id = $2 AND role = 'customer'`,
        [isActive, id],
      );
    } catch (e) { mapPgError(e); }
  },

  async updateProfile(
    id: string,
    patch: {
      email?: string | null;
      phone_number?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      gender_preference?: string | null;
      marketing_opt_in?: boolean;
    },
  ): Promise<void> {
    // Split fields between users and customer_profiles. The customer_profiles
    // row is created on first booking — if it doesn't exist yet, UPSERT.
    const userSets: string[] = [];
    const userParams: unknown[] = [];
    if (patch.email !== undefined)        { userParams.push(patch.email);        userSets.push(`email = $${userParams.length}`); }
    if (patch.phone_number !== undefined) { userParams.push(patch.phone_number); userSets.push(`phone_number = $${userParams.length}`); }
    if (userSets.length > 0) {
      userSets.push(`updated_at = NOW()`);
      userParams.push(id);
      try {
        await query(`UPDATE public.users SET ${userSets.join(', ')} WHERE id = $${userParams.length} AND role = 'customer'`, userParams);
      } catch (e) { mapPgError(e); }
    }

    const profileSets: string[] = [];
    const profileParams: unknown[] = [];
    if (patch.first_name !== undefined)        { profileParams.push(patch.first_name);        profileSets.push(`first_name = $${profileParams.length}`); }
    if (patch.last_name !== undefined)         { profileParams.push(patch.last_name);         profileSets.push(`last_name = $${profileParams.length}`); }
    if (patch.gender_preference !== undefined) { profileParams.push(patch.gender_preference); profileSets.push(`gender_preference = $${profileParams.length}`); }
    if (patch.marketing_opt_in !== undefined)  { profileParams.push(patch.marketing_opt_in);  profileSets.push(`marketing_opt_in = $${profileParams.length}`); }
    if (profileSets.length > 0) {
      profileSets.push(`updated_at = NOW()`);
      profileParams.push(id);
      // UPSERT — create the customer_profiles row if it doesn't exist yet.
      try {
        await query(
          `INSERT INTO public.customer_profiles
             (user_id, first_name, last_name, gender_preference, marketing_opt_in)
           VALUES ($${profileParams.length}, $1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET ${profileSets.join(', ')}`,
          profileParams,
        );
      } catch {
        // Fallback for older schemas without the unique constraint name match.
        // Plain UPDATE — if the row doesn't exist this will affect 0 rows;
        // accept that and rely on the booking flow to create the profile.
        try {
          await query(
            `UPDATE public.customer_profiles SET ${profileSets.join(', ')} WHERE user_id = $${profileParams.length}`,
            profileParams,
          );
        } catch (e) { mapPgError(e); }
      }
    }
  },
};
