// ─────────────────────────────────────────────────────────────────────────────
// Admin Staff — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { StaffListQuery } from './admin-staff.schemas';

export interface StaffRow {
  id: string;
  user_id: string;
  email: string | null;
  phone_number: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  employer_id: string;
  employer_display_name: string;
  employer_city: string | null;
  is_active: boolean;
  hire_date: string;
  total_appointments: number;
  last_seen_at: string | null;
  created_at: string;
}

export const adminStaffRepository = {
  async list(q: StaffListQuery): Promise<{ rows: StaffRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.employer_id) push('sm.employer_id = ?', q.employer_id);
    if (q.role && q.role !== 'all') push('sm.role = ?', q.role);
    if (q.is_active !== undefined) push('sm.is_active = ?', q.is_active);
    if (q.city) {
      params.push(`%${q.city.toLowerCase()}%`);
      conditions.push(`LOWER(sl.city) LIKE $${params.length}`);
    }
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(COALESCE(cp.first_name,'')) LIKE ${p}
          OR LOWER(COALESCE(cp.last_name,'')) LIKE ${p}
          OR LOWER(COALESCE(u.email,'')) LIKE ${p}
          OR COALESCE(u.phone_number,'') LIKE ${p}
          OR LOWER(sl.display_name) LIKE ${p})`,
      );
    }

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(
          `(sm.created_at, sm.id) < ($${params.length - 1}, $${params.length})`,
        );
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<StaffRow>(
      `SELECT sm.id,
              sm.user_id,
              u.email,
              u.phone_number,
              cp.first_name,
              cp.last_name,
              sm.role::text AS role,
              sm.employer_id,
              sl.display_name AS employer_display_name,
              sl.city         AS employer_city,
              sm.is_active,
              sm.hire_date,
              COALESCE(agg.total_appointments, 0) AS total_appointments,
              u.last_login_at AS last_seen_at,
              sm.created_at
       FROM public.staff_members sm
       JOIN public.users u ON u.id = sm.user_id
       LEFT JOIN public.customer_profiles cp ON cp.user_id = u.id
       JOIN public.salon_locations sl ON sl.id = sm.employer_id
       LEFT JOIN (
         SELECT staff_member_id, COUNT(*)::int AS total_appointments
         FROM public.appointments
         GROUP BY staff_member_id
       ) agg ON agg.staff_member_id = sm.id
       ${where}
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<StaffRow | null> {
    return queryOne<StaffRow>(
      `SELECT sm.id,
              sm.user_id,
              u.email,
              u.phone_number,
              cp.first_name,
              cp.last_name,
              sm.role::text AS role,
              sm.employer_id,
              sl.display_name AS employer_display_name,
              sl.city         AS employer_city,
              sm.is_active,
              sm.hire_date,
              COALESCE(agg.total_appointments, 0) AS total_appointments,
              u.last_login_at AS last_seen_at,
              sm.created_at
       FROM public.staff_members sm
       JOIN public.users u ON u.id = sm.user_id
       LEFT JOIN public.customer_profiles cp ON cp.user_id = u.id
       JOIN public.salon_locations sl ON sl.id = sm.employer_id
       LEFT JOIN (
         SELECT staff_member_id, COUNT(*)::int AS total_appointments
         FROM public.appointments
         GROUP BY staff_member_id
       ) agg ON agg.staff_member_id = sm.id
       WHERE sm.id = $1`,
      [id],
    );
  },

  async update(id: string, patch: { role?: string; is_active?: boolean; commission_percentage?: number }): Promise<void> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    if (patch.role !== undefined) {
      // role is a plain TEXT FK to staff_roles.code as of migration 091 —
      // no longer an ENUM, so no cast. The old `::staff_role` cast referenced
      // a type that migration 091 dropped; left in place, this line would
      // fail every update with "type staff_role does not exist."
      params.push(patch.role); sets.push(`role = $${params.length}`);
    }
    if (patch.is_active !== undefined) {
      params.push(patch.is_active); sets.push(`is_active = $${params.length}`);
    }
    if (patch.commission_percentage !== undefined) {
      params.push(patch.commission_percentage); sets.push(`commission_percentage = $${params.length}`);
    }
    if (sets.length === 1) return;
    params.push(id);
    try {
      await query(`UPDATE public.staff_members SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    } catch (e) { mapPgError(e); }
  },
};
