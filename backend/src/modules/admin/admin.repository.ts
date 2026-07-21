import { query, queryOne } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';

export const adminRepository = {
  async getPendingKyc() {
    const [freelancers, salons] = await Promise.all([
      query(
        `SELECT fp.id, fp.business_name, fp.display_name, fp.city,
                fp.created_at, u.email, u.phone_number
         FROM public.freelancer_profiles fp
         JOIN public.users u ON fp.user_id = u.id
         WHERE fp.is_verified = FALSE AND fp.is_active = TRUE
         ORDER BY fp.created_at ASC
         LIMIT 100`,
        [],
      ),
      query(
        `SELECT sl.id, sl.display_name, sl.city, sl.created_at,
                ba.legal_business_name, u.email
         FROM public.salon_locations sl
         JOIN public.business_accounts ba ON sl.business_account_id = ba.id
         JOIN public.users u ON ba.owner_user_id = u.id
         WHERE sl.is_verified = FALSE AND sl.is_active = TRUE
         ORDER BY sl.created_at ASC
         LIMIT 100`,
        [],
      ),
    ]);

    return {
      freelancers: freelancers.rows,
      salons: salons.rows,
      total_pending: (freelancers.rowCount ?? 0) + (salons.rowCount ?? 0),
    };
  },

  async approveFreelancer(freelancerId: string) {
    try {
      return await queryOne(
        `UPDATE public.freelancer_profiles
         SET is_verified = TRUE, updated_at = NOW()
         WHERE id = $1
         RETURNING id, business_name, is_verified`,
        [freelancerId],
      );
    } catch (e) { mapPgError(e); }
  },

  async rejectFreelancer(freelancerId: string) {
    try {
      return await queryOne(
        `UPDATE public.freelancer_profiles
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1
         RETURNING id, business_name, is_active`,
        [freelancerId],
      );
    } catch (e) { mapPgError(e); }
  },

  async approveSalon(locationId: string) {
    try {
      return await queryOne(
        `UPDATE public.salon_locations
         SET is_verified = TRUE, updated_at = NOW()
         WHERE id = $1
         RETURNING id, display_name, is_verified`,
        [locationId],
      );
    } catch (e) { mapPgError(e); }
  },

  async rejectSalon(locationId: string) {
    try {
      return await queryOne(
        `UPDATE public.salon_locations
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1
         RETURNING id, display_name, is_active`,
        [locationId],
      );
    } catch (e) { mapPgError(e); }
  },

  async listUsers(filters: { role?: string; is_active?: boolean; page: number; limit: number }) {
    const conditions: string[] = ['u.deleted_at IS NULL'];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters.role) { conditions.push(`u.role = $${paramIdx++}`); params.push(filters.role); }
    if (filters.is_active !== undefined) {
      conditions.push(`u.is_active = $${paramIdx++}`);
      params.push(filters.is_active);
    }

    const offset = (filters.page - 1) * filters.limit;

    const [countResult, rowsResult] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total FROM public.users u WHERE ${conditions.join(' AND ')}`,
        params,
      ),
      query(
        `SELECT u.id, u.email, u.phone_number, u.role, u.is_active,
                u.is_email_verified, u.created_at, u.last_login_at
         FROM public.users u
         WHERE ${conditions.join(' AND ')}
         ORDER BY u.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, filters.limit, offset],
      ),
    ]);

    return {
      users: rowsResult.rows,
      total: parseInt((countResult.rows[0] as { total: string }).total, 10),
      page: filters.page,
      limit: filters.limit,
    };
  },

  async getUserById(userId: string): Promise<{ id: string; email: string; role: string; is_active: boolean } | null> {
    return queryOne<{ id: string; email: string; role: string; is_active: boolean }>(
      `SELECT id, email, role, is_active FROM public.users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
  },

  async setUserActiveStatus(userId: string, isActive: boolean) {
    try {
      return await queryOne(
        `UPDATE public.users SET is_active = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, role, is_active`,
        [userId, isActive],
      );
    } catch (e) { mapPgError(e); }
  },

  async getPlatformStats() {
    const result = await query(
      `SELECT
         (SELECT COUNT(*) FROM public.users WHERE deleted_at IS NULL)::int AS total_users,
         (SELECT COUNT(*) FROM public.freelancer_profiles WHERE is_active = TRUE)::int AS active_freelancers,
         (SELECT COUNT(*) FROM public.freelancer_profiles WHERE is_verified = FALSE AND is_active = TRUE)::int AS pending_kyc_freelancers,
         (SELECT COUNT(*) FROM public.salon_locations WHERE is_active = TRUE)::int AS active_salons,
         (SELECT COUNT(*) FROM public.salon_locations WHERE is_verified = FALSE AND is_active = TRUE)::int AS pending_kyc_salons,
         (SELECT COUNT(*) FROM public.appointments WHERE status = 'completed')::int AS completed_appointments,
         (SELECT COUNT(*) FROM public.appointments WHERE status IN ('confirmed', 'in_progress'))::int AS active_appointments,
         (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE status = 'completed') AS total_revenue`,
      [],
    );
    return result.rows[0];
  },

  // Category repository methods (listCategories, promoteCategoryToGlobal,
  // createCategory, updateCategory, deleteCategory) moved to the
  // admin-categories module on 2026-05-29 — see
  // backend/src/modules/admin-categories/admin-categories.repository.ts.
};
