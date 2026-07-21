import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';

export const staffRepository = {
  // ─── Role catalogue (migration 091: staff_role ENUM → staff_roles table) ──

  async listActiveRoleCodes(): Promise<string[]> {
    const result = await query<{ code: string }>(
      `SELECT code FROM public.staff_roles WHERE is_active = TRUE ORDER BY sort_order`,
    );
    return result.rows.map((r) => r.code);
  },

  // ─── Lookup helper (used by every other method) ──────────────────────────

  async findStaffMemberByUserId(userId: string) {
    return queryOne<{
      id: string;
      employer_id: string;
      commission_percentage: number;
      role: string;
      is_active: boolean;
      base_salary: number | null;
      monthly_revenue_target: number;
      monthly_booking_target: number;
      rating_target: number;
      incentive_pool: number;
    }>(
      `SELECT id, employer_id, commission_percentage, role, is_active,
              base_salary, monthly_revenue_target, monthly_booking_target,
              rating_target, incentive_pool
       FROM public.staff_members WHERE user_id = $1 AND is_active = TRUE`,
      [userId],
    );
  },

  // ─── STF-11: Profile ──────────────────────────────────────────────────────

  async getProfile(staffMemberId: string, userId: string) {
    return queryOne<{
      staff_member_id: string;
      user_id: string;
      role: string;
      commission_percentage: number;
      base_salary: number | null;
      hire_date: string | null;
      avatar_url: string | null;
      address: string | null;
      employer_name: string | null;
      employer_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone_number: string | null;
      average_rating: number;
    }>(
      `SELECT
         sm.id            AS staff_member_id,
         u.id             AS user_id,
         sm.role,
         sm.commission_percentage,
         sm.base_salary,
         sm.hire_date,
         sm.avatar_url,
         sm.address,
         sm.employer_id,
         sl.display_name  AS employer_name,
         u.first_name,
         u.last_name,
         u.email,
         u.phone_number,
         COALESCE(
           (SELECT ROUND(AVG(r.rating)::numeric, 2)
            FROM public.reviews r
            WHERE r.staff_member_id = sm.id),
           0
         ) AS average_rating
       FROM public.staff_members sm
       JOIN public.users u ON u.id = sm.user_id
       LEFT JOIN public.salon_locations sl ON sl.id = sm.employer_id
       WHERE sm.id = $1 AND u.id = $2`,
      [staffMemberId, userId],
    );
  },

  async updateProfile(staffMemberId: string, userId: string, patch: {
    full_name?: string;
    email?: string;
    address?: string;
    avatar_url?: string;
  }) {
    // Update users table fields
    if (patch.full_name || patch.email) {
      const nameParts = patch.full_name?.split(' ') ?? [];
      const first_name = nameParts[0] ?? null;
      const last_name = nameParts.slice(1).join(' ') || null;

      try {
        await query(
          `UPDATE public.users
           SET first_name  = COALESCE($1, first_name),
               last_name   = COALESCE($2, last_name),
               email       = COALESCE($3, email),
               updated_at  = NOW()
           WHERE id = $4`,
          [first_name, last_name, patch.email ?? null, userId],
        );
      } catch (e) { mapPgError(e); }
    }

    // Update staff_members fields
    if (patch.address !== undefined || patch.avatar_url !== undefined) {
      try {
        await query(
          `UPDATE public.staff_members
           SET address    = COALESCE($1, address),
               avatar_url = COALESCE($2, avatar_url),
               updated_at = NOW()
           WHERE id = $3`,
          [patch.address ?? null, patch.avatar_url ?? null, staffMemberId],
        );
      } catch (e) { mapPgError(e); }
    }
  },

  // ─── STF-12: Documents ────────────────────────────────────────────────────

  async getDocuments(staffMemberId: string) {
    const result = await query(
      `SELECT id, document_type, document_number, file_url, status, notes, created_at
       FROM public.staff_documents
       WHERE staff_member_id = $1
       ORDER BY created_at DESC`,
      [staffMemberId],
    );
    return result.rows;
  },

  async upsertDocument(
    staffMemberId: string,
    doc: { document_type: string; document_number?: string; file_url?: string },
  ) {
    try {
      return await queryOne(
        `INSERT INTO public.staff_documents
           (staff_member_id, document_type, document_number, file_url, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (staff_member_id, document_type)
         DO UPDATE SET
           document_number = COALESCE(EXCLUDED.document_number, staff_documents.document_number),
           file_url        = COALESCE(EXCLUDED.file_url, staff_documents.file_url),
           status          = 'pending',
           updated_at      = NOW()
         RETURNING id, document_type, document_number, file_url, status, created_at`,
        [staffMemberId, doc.document_type, doc.document_number ?? null, doc.file_url ?? null],
      );
    } catch (e) { mapPgError(e); }
  },

  // ─── STF-13: Bank Details ─────────────────────────────────────────────────

  async getBankDetails(staffMemberId: string) {
    return queryOne<{
      id: string;
      bank_name: string;
      account_holder: string;
      account_number: string;
      ifsc_code: string;
      is_verified: boolean;
      payment_mode: string;
    }>(
      `SELECT id, bank_name, account_holder, account_number, ifsc_code, is_verified, payment_mode
       FROM public.staff_bank_details
       WHERE staff_member_id = $1`,
      [staffMemberId],
    );
  },

  async upsertBankDetails(
    staffMemberId: string,
    details: { bank_name: string; account_holder: string; account_number: string; ifsc_code: string; payment_mode?: string },
  ) {
    try {
      return await queryOne(
        `INSERT INTO public.staff_bank_details
           (staff_member_id, bank_name, account_holder, account_number, ifsc_code, payment_mode, is_verified)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)
         ON CONFLICT (staff_member_id)
         DO UPDATE SET
           bank_name       = EXCLUDED.bank_name,
           account_holder  = EXCLUDED.account_holder,
           account_number  = EXCLUDED.account_number,
           ifsc_code       = EXCLUDED.ifsc_code,
           payment_mode    = COALESCE(EXCLUDED.payment_mode, staff_bank_details.payment_mode),
           is_verified     = FALSE,
           updated_at      = NOW()
         RETURNING id, bank_name, account_holder, account_number, ifsc_code, is_verified, payment_mode`,
        [staffMemberId, details.bank_name, details.account_holder, details.account_number, details.ifsc_code, details.payment_mode ?? 'bank_transfer'],
      );
    } catch (e) { mapPgError(e); }
  },

  // ─── STF-01: Schedule ─────────────────────────────────────────────────────

  async getSchedule(staffMemberId: string, weekStart: string, weekEnd: string) {
    const [shifts, appointments] = await Promise.all([
      query(
        `SELECT id, shift_date, start_time, end_time, type, is_approved, notes
         FROM public.shift_schedules
         WHERE staff_member_id = $1
           AND shift_date BETWEEN $2::date AND $3::date
         ORDER BY shift_date, start_time`,
        [staffMemberId, weekStart, weekEnd],
      ),
      query(
        `SELECT a.id,
                a.start_time,
                a.end_time,
                a.status,
                TRIM(CONCAT(cp.first_name, ' ', COALESCE(cp.last_name, ''))) AS customer_name,
                COALESCE(li.services, '[]'::jsonb) AS services,
                COALESCE(li.total_amount, 0) AS total_amount,
                COALESCE(li.total_duration, 0) AS total_duration
         FROM public.appointments a
         LEFT JOIN public.customer_profiles cp ON cp.user_id = a.customer_id
         LEFT JOIN LATERAL (
           SELECT
             jsonb_agg(
               jsonb_build_object(
                 'service_id', ali.service_id,
                 'service_name', ali.service_name,
                 'locked_price', ali.locked_price,
                 'duration_minutes', ali.duration_minutes
               ) ORDER BY ali.created_at
             ) AS services,
             SUM(ali.locked_price) AS total_amount,
             SUM(ali.duration_minutes) AS total_duration
           FROM public.appointment_line_items ali
           WHERE ali.appointment_id = a.id
         ) li ON TRUE
         WHERE a.staff_member_id = $1
           AND a.start_time >= $2::date::timestamptz
           AND a.start_time < ($3::date + interval '1 day')::timestamptz
           AND a.status NOT IN ('cancelled')
         ORDER BY a.start_time`,
        [staffMemberId, weekStart, weekEnd],
      ),
    ]);

    return { shifts: shifts.rows, appointments: appointments.rows };
  },

  // ─── STF-02: Earnings ─────────────────────────────────────────────────────

  async getEarnings(staffMemberId: string, fromDate: string, toDate: string) {
    const result = await query(
      `SELECT
         a.id AS appointment_id,
         a.start_time,
         a.status,
         t.amount,
         sm.commission_percentage,
         sm.base_salary,
         ROUND((COALESCE(t.amount, 0) * sm.commission_percentage / 100)::numeric, 2) AS commission_earned
       FROM public.appointments a
       JOIN public.staff_members sm ON a.staff_member_id = sm.id
       LEFT JOIN public.transactions t ON t.appointment_id = a.id AND t.status = 'completed'
       WHERE sm.id = $1
         AND a.start_time >= $2::date::timestamptz
         AND a.start_time < ($3::date + interval '1 day')::timestamptz
         AND a.status = 'completed'
       ORDER BY a.start_time DESC`,
      [staffMemberId, fromDate, toDate],
    );

    const rows = result.rows as {
      appointment_id: string;
      start_time: string;
      status: string;
      amount: number | null;
      commission_percentage: number;
      base_salary: number | null;
      commission_earned: number;
    }[];

    const total_commission = rows.reduce((sum, r) => sum + Number(r.commission_earned), 0);
    const base_salary = rows[0]?.base_salary ?? 0;

    return {
      appointments: rows,
      total_commission: Math.round(total_commission * 100) / 100,
      base_salary: Number(base_salary),
      period: { from_date: fromDate, to_date: toDate },
    };
  },

  // ─── STF-03: Appointment status change ───────────────────────────────────

  async findAppointmentForStaff(appointmentId: string, staffMemberId: string) {
    return queryOne(
      `SELECT a.id, a.status, a.start_time
       FROM public.appointments a
       WHERE a.id = $1 AND a.staff_member_id = $2`,
      [appointmentId, staffMemberId],
    );
  },

  async updateAppointmentStatus(appointmentId: string, staffMemberId: string, status: string) {
    try {
      return await queryOne(
        `UPDATE public.appointments
         SET status = $3::appointment_status, updated_at = NOW()
         WHERE id = $1 AND staff_member_id = $2
         RETURNING id, status, start_time, end_time`,
        [appointmentId, staffMemberId, status],
      );
    } catch (e) { mapPgError(e); }
  },

  // ─── STF-04 / STF-05 / STF-06: Clock-in/out ──────────────────────────────

  async clockIn(staffMemberId: string) {
    try {
      return await queryOne<{ id: string; clock_in_at: string; date: string }>(
        `INSERT INTO public.staff_attendance (staff_member_id, date)
         VALUES ($1, CURRENT_DATE)
         RETURNING id, clock_in_at, date`,
        [staffMemberId],
      );
    } catch (e) { mapPgError(e); }
  },

  async clockOut(staffMemberId: string) {
    try {
      return await queryOne(
        `UPDATE public.staff_attendance
         SET clock_out_at = NOW()
         WHERE staff_member_id = $1
           AND date = CURRENT_DATE
           AND clock_out_at IS NULL
         RETURNING id, clock_in_at, clock_out_at, date`,
        [staffMemberId],
      );
    } catch (e) { mapPgError(e); }
  },

  async getOpenClockIn(staffMemberId: string) {
    return queryOne(
      `SELECT id FROM public.staff_attendance
       WHERE staff_member_id = $1 AND date = CURRENT_DATE AND clock_out_at IS NULL`,
      [staffMemberId],
    );
  },

  async getClockStatus(staffMemberId: string) {
    return queryOne<{ id: string; clock_in_at: string; clock_out_at: string | null; date: string }>(
      `SELECT id, clock_in_at, clock_out_at, date
       FROM public.staff_attendance
       WHERE staff_member_id = $1 AND date = CURRENT_DATE
       ORDER BY clock_in_at DESC
       LIMIT 1`,
      [staffMemberId],
    );
  },

  async getAttendanceHistory(
    staffMemberId: string,
    params: { from_date?: string; to_date?: string; limit?: number },
  ) {
    const now = new Date();
    const from = params.from_date ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = params.to_date ?? now.toISOString().slice(0, 10);
    const limit = params.limit ?? 30;

    const result = await query(
      `SELECT id, clock_in_at, clock_out_at, date,
              ROUND(
                EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) / 3600,
                2
              ) AS hours_worked
       FROM public.staff_attendance
       WHERE staff_member_id = $1
         AND date BETWEEN $2::date AND $3::date
       ORDER BY date DESC, clock_in_at DESC
       LIMIT $4`,
      [staffMemberId, from, to, limit],
    );
    return result.rows;
  },

  // ─── STF-08: Weekly Chart ─────────────────────────────────────────────────

  async getWeeklyChart(staffMemberId: string) {
    const result = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('day', a.start_time), 'Dy') AS day,
         COUNT(DISTINCT a.id) AS services,
         COALESCE(SUM(ali.locked_price) FILTER (WHERE a.status = 'completed'), 0) AS earnings
       FROM public.appointments a
       LEFT JOIN public.appointment_line_items ali ON ali.appointment_id = a.id
       WHERE a.staff_member_id = $1
         AND a.start_time >= DATE_TRUNC('week', NOW())
         AND a.start_time < DATE_TRUNC('week', NOW()) + INTERVAL '7 days'
       GROUP BY DATE_TRUNC('day', a.start_time)
       ORDER BY DATE_TRUNC('day', a.start_time)`,
      [staffMemberId],
    );
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    type DayRow = { day: string; services?: number | string; earnings?: number | string };
    const map = new Map<string, DayRow>(
      (result.rows as DayRow[]).map((r) => [String(r.day).trim(), r]),
    );
    return DAYS.map((d) => ({
      day: d,
      services: Number(map.get(d)?.services ?? 0),
      earnings: Number(map.get(d)?.earnings ?? 0),
    }));
  },

  // ─── STF-09: Targets (from DB, not hardcoded) ─────────────────────────────

  async getTargets(staffMemberId: string) {
    const result = await query(
      `SELECT
         sm.monthly_revenue_target,
         sm.monthly_booking_target,
         sm.rating_target,
         sm.incentive_pool,
         COUNT(DISTINCT a.id) FILTER (
           WHERE a.status = 'completed'
           AND DATE_TRUNC('month', a.start_time) = DATE_TRUNC('month', NOW())
         ) AS bookings_achieved,
         COALESCE(SUM(ali.locked_price) FILTER (
           WHERE a.status = 'completed'
           AND DATE_TRUNC('month', a.start_time) = DATE_TRUNC('month', NOW())
         ), 0) AS revenue_achieved,
         COALESCE(AVG(r.rating) FILTER (
           WHERE DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', NOW())
         ), 0) AS current_rating,
         COALESCE(SUM(ali.locked_price) FILTER (
           WHERE a.status = 'completed'
           AND DATE_TRUNC('month', a.start_time) = DATE_TRUNC('month', NOW())
         ) * sm.commission_percentage / 100, 0) AS incentive_earned
       FROM public.staff_members sm
       LEFT JOIN public.appointments a ON a.staff_member_id = sm.id
       LEFT JOIN public.appointment_line_items ali ON ali.appointment_id = a.id
       LEFT JOIN public.reviews r ON r.staff_member_id = sm.id
       WHERE sm.id = $1
       GROUP BY sm.id, sm.monthly_revenue_target, sm.monthly_booking_target,
                sm.rating_target, sm.incentive_pool, sm.commission_percentage`,
      [staffMemberId],
    );
    const row = (result.rows[0] ?? {}) as Record<string, number | string | null | undefined>;
    return {
      revenue_target:     Number(row.monthly_revenue_target ?? 80000),
      booking_target:     Number(row.monthly_booking_target ?? 80),
      rating_target:      Number(row.rating_target ?? 4.5),
      revenue_achieved:   Number(row.revenue_achieved ?? 0),
      bookings_achieved:  Number(row.bookings_achieved ?? 0),
      current_rating:     Number(Number(row.current_rating ?? 0).toFixed(1)),
      incentive_earned:   Math.round(Number(row.incentive_earned ?? 0) * 100) / 100,
      incentive_max:      Number(row.incentive_pool ?? 5000),
    };
  },

  // ─── STF-10: Commission History (via staff_payouts) ───────────────────────

  async getCommissionHistory(staffMemberId: string) {
    // Compute live from appointments grouped by month. The persisted
    // `staff_payouts` table only stores aggregate `amount` per period, so it
    // can't power the per-row commission breakdown the dashboard needs.
    const liveResult = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', a.start_time), 'Mon YYYY') AS month,
         COUNT(DISTINCT a.id) AS services,
         COALESCE(SUM(ali.locked_price), 0) AS revenue,
         COALESCE(SUM(ali.locked_price) * sm.commission_percentage / 100, 0) AS commission
       FROM public.appointments a
       JOIN public.staff_members sm ON a.staff_member_id = sm.id
       LEFT JOIN public.appointment_line_items ali ON ali.appointment_id = a.id
       WHERE sm.id = $1
         AND a.status = 'completed'
         AND a.start_time >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', a.start_time), sm.commission_percentage
       ORDER BY DATE_TRUNC('month', a.start_time) DESC`,
      [staffMemberId],
    );
    type CommissionRow = { month: string; services: number | string; revenue: number | string; commission: number | string };
    return (liveResult.rows as CommissionRow[]).map((r) => ({
      month:      r.month,
      services:   Number(r.services),
      revenue:    Number(r.revenue),
      commission: Number(r.commission),
      bonus:      0,
      deductions: 0,
      payout:     Number(r.commission),
      status:     'computed',
    }));
  },

  // ─── STF-14: Staff-Level Reviews ──────────────────────────────────────────

  async getReviews(staffMemberId: string, params: { limit?: number; offset?: number }) {
    const limit  = params.limit  ?? 20;
    const offset = params.offset ?? 0;

    const result = await query(
      `SELECT
         r.id,
         r.rating,
         r.comment,
         r.vendor_reply,
         r.vendor_reply_at,
         CONCAT(u.first_name, ' ', LEFT(u.last_name, 1), '.') AS author_name,
         r.created_at
       FROM public.reviews r
       JOIN public.users u ON u.id = r.customer_id
       WHERE r.staff_member_id = $1
         AND r.is_visible = TRUE
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [staffMemberId, limit, offset],
    );
    return result.rows;
  },

  // ─── STF-15: My Bookings (cursor-paginated historical list) ─────────────
  // Powers the staff /appointments page's full timeline (the existing
  // /me/schedule only returns a week). Filters on status / date / search;
  // cursor pagination keeps the order stable under concurrent inserts.

  async listMyBookings(
    staffMemberId: string,
    q: {
      status?: string;
      from?: string;
      to?: string;
      search?: string;
      cursor?: string;
      limit: number;
    },
  ): Promise<{
    rows: Array<{
      id: string;
      short_id: string;
      start_time: string;
      end_time: string;
      status: string;
      customer_id: string;
      customer_name: string | null;
      customer_phone: string | null;
      service_count: number;
      gross_amount: number;
      payment_method: string | null;
      payment_status: string | null;
      otp_verified_at: string | null;
      created_at: string;
    }>;
    hasMore: boolean;
  }> {
    const conditions: string[] = ['a.staff_member_id = $1'];
    const params: unknown[] = [staffMemberId];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.status && q.status !== 'all') push('a.status = ?', q.status);
    if (q.from)                         push('a.start_time >= ?', q.from);
    if (q.to)                           push('a.start_time <= ?', q.to);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(SUBSTRING(a.id::text, 1, 8)) LIKE ${p}
          OR LOWER(COALESCE(cp.first_name, '')) LIKE ${p}
          OR LOWER(COALESCE(cp.last_name, '')) LIKE ${p}
          OR COALESCE(u.phone_number, '') LIKE ${p})`,
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

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<{
      id: string;
      short_id: string;
      start_time: string;
      end_time: string;
      status: string;
      customer_id: string;
      customer_name: string | null;
      customer_phone: string | null;
      service_count: number;
      gross_amount: number;
      payment_method: string | null;
      payment_status: string | null;
      otp_verified_at: string | null;
      created_at: string;
    }>(
      `SELECT a.id,
              SUBSTRING(a.id::text, 1, 8) AS short_id,
              a.start_time, a.end_time,
              a.status::text AS status,
              a.customer_id,
              CONCAT(COALESCE(cp.first_name, ''), CASE WHEN cp.last_name IS NOT NULL THEN ' ' || LEFT(cp.last_name, 1) || '.' ELSE '' END) AS customer_name,
              u.phone_number AS customer_phone,
              (SELECT COUNT(*)::int FROM public.appointment_line_items WHERE appointment_id = a.id) AS service_count,
              COALESCE(t.amount, 0)::float8 AS gross_amount,
              t.payment_method::text AS payment_method,
              t.status::text AS payment_status,
              a.otp_verified_at,
              a.created_at
       FROM public.appointments a
       JOIN public.users u ON u.id = a.customer_id
       LEFT JOIN public.customer_profiles cp ON cp.user_id = a.customer_id
       LEFT JOIN public.transactions t ON t.appointment_id = a.id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getReviewSummary(staffMemberId: string) {
    const result = await query(
      `SELECT
         COUNT(*)::int                                              AS total_count,
         COALESCE(ROUND(AVG(rating)::numeric, 2), 0)              AS avg_rating,
         COUNT(*) FILTER (WHERE rating = 5)::int                  AS rating_5,
         COUNT(*) FILTER (WHERE rating = 4)::int                  AS rating_4,
         COUNT(*) FILTER (WHERE rating = 3)::int                  AS rating_3,
         COUNT(*) FILTER (WHERE rating = 2)::int                  AS rating_2,
         COUNT(*) FILTER (WHERE rating = 1)::int                  AS rating_1
       FROM public.reviews
       WHERE staff_member_id = $1`,
      [staffMemberId],
    );
    const row = result.rows[0] ?? {};
    return {
      total_count: Number(row.total_count ?? 0),
      avg_rating:  Number(row.avg_rating  ?? 0),
      rating_5:    Number(row.rating_5    ?? 0),
      rating_4:    Number(row.rating_4    ?? 0),
      rating_3:    Number(row.rating_3    ?? 0),
      rating_2:    Number(row.rating_2    ?? 0),
      rating_1:    Number(row.rating_1    ?? 0),
    };
  },
};
