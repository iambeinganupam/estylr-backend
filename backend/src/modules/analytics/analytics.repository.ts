// ─────────────────────────────────────────────────────────────────────────────
// Analytics Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';

function intervalForRange(range: string): string {
  switch (range) {
    case 'today': return '0 days';
    case 'week':
    case '7d':
      return '7 days';
    case 'month':
    case '30d':
      return '30 days';
    case 'quarter':
    case '90d':
      return '90 days';
    default: return '30 days';
  }
}

/**
 * Walk-in appointments have customer_id = NULL but identify the customer via
 * `customer_name` + `customer_phone`. Use phone (when present) as a stable
 * dedup key; otherwise fall back to the appointment id so each walk-in still
 * counts as one unique entity for "new customers" math.
 */
const CUSTOMER_DEDUP_EXPR = `COALESCE(a.customer_id::text, NULLIF(a.customer_phone, ''), a.id::text)`;

// Appointments are stored in UTC; Indian businesses operate in IST (Asia/Kolkata)
const TZ = 'Asia/Kolkata';

export const analyticsRepository = {
  async getKPI(vendorId: string, range: string, start?: string, end?: string) {
    // Two filter axes — appointment-window (counts: bookings, completion,
    // no-shows) vs transaction-window (revenue, avg booking value). Splitting
    // them matters because a cash collection done TODAY for an appointment
    // SCHEDULED TOMORROW should still count in "Today's Revenue" — that's
    // what a salon owner means when they look at the till.
    const interval = intervalForRange(range);

    let apptCurrent: string;
    let apptPrior: string;
    let txCurrent: string;
    let txPrior: string;
    if (range === 'custom' && start && end) {
      apptCurrent = `(a.start_time AT TIME ZONE '${TZ}')::date >= '${start}'::date AND (a.start_time AT TIME ZONE '${TZ}')::date <= '${end}'::date`;
      apptPrior   = `(a.start_time AT TIME ZONE '${TZ}')::date >= ('${start}'::date - ('${end}'::date - '${start}'::date) - interval '1 day') AND (a.start_time AT TIME ZONE '${TZ}')::date < '${start}'::date`;
      txCurrent   = `(t.created_at AT TIME ZONE '${TZ}')::date >= '${start}'::date AND (t.created_at AT TIME ZONE '${TZ}')::date <= '${end}'::date`;
      txPrior     = `(t.created_at AT TIME ZONE '${TZ}')::date >= ('${start}'::date - ('${end}'::date - '${start}'::date) - interval '1 day') AND (t.created_at AT TIME ZONE '${TZ}')::date < '${start}'::date`;
    } else if (range === 'today') {
      apptCurrent = `(a.start_time AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date`;
      apptPrior   = `(a.start_time AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date - 1`;
      txCurrent   = `(t.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date`;
      txPrior     = `(t.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date - 1`;
    } else {
      apptCurrent = `a.start_time >= NOW() - interval '${interval}'`;
      apptPrior   = `a.start_time >= NOW() - interval '${interval}' * 2 AND a.start_time < NOW() - interval '${interval}'`;
      txCurrent   = `t.created_at >= NOW() - interval '${interval}'`;
      txPrior     = `t.created_at >= NOW() - interval '${interval}' * 2 AND t.created_at < NOW() - interval '${interval}'`;
    }

    return queryOne(
      `WITH appt_current AS (
         SELECT a.*, r.rating
         FROM public.appointments a
         LEFT JOIN public.reviews r ON r.appointment_id = a.id
         WHERE a.vendor_id = $1 AND ${apptCurrent}
       ),
       appt_prior AS (
         SELECT a.id
         FROM public.appointments a
         WHERE a.vendor_id = $1 AND ${apptPrior}
       ),
       tx_current AS (
         SELECT COALESCE(SUM(t.amount), 0)::float AS amt
         FROM public.transactions t
         WHERE t.vendor_id = $1 AND t.status = 'completed' AND ${txCurrent}
       ),
       tx_prior AS (
         SELECT COALESCE(SUM(t.amount), 0)::float AS amt
         FROM public.transactions t
         WHERE t.vendor_id = $1 AND t.status = 'completed' AND ${txPrior}
       )
       SELECT
         (SELECT COUNT(*) FROM appt_current)::int                                          AS total_bookings,
         (SELECT COUNT(*) FROM appt_current WHERE status = 'completed')::int               AS completed_appointments,
         (SELECT COUNT(*) FROM appt_current WHERE status = 'cancelled')::int               AS cancelled_appointments,
         (SELECT COUNT(*) FROM appt_current WHERE status = 'no_show')::int                 AS no_shows,
         (SELECT amt FROM tx_current)                                                      AS total_revenue,
         (SELECT COUNT(DISTINCT ${CUSTOMER_DEDUP_EXPR}) FROM appt_current a WHERE status = 'completed')::int AS new_customers,
         (SELECT COALESCE(AVG(rating), 0)::float FROM appt_current)                        AS average_rating,
         CASE WHEN (SELECT COUNT(*) FROM appt_current) > 0
              THEN ROUND((SELECT COUNT(*) FROM appt_current WHERE status = 'completed') * 100.0 /
                         (SELECT COUNT(*) FROM appt_current), 1)
              ELSE 0 END::float                                                            AS completion_rate,
         CASE WHEN (SELECT COUNT(*) FROM appt_current WHERE status = 'completed') > 0
              THEN ROUND((SELECT amt FROM tx_current)::numeric /
                         (SELECT COUNT(*) FROM appt_current WHERE status = 'completed'), 2)
              ELSE 0 END::float                                                            AS avg_booking_value,
         -- Period-over-period change percentages. NULL when the prior period
         -- had zero so the UI renders "—" instead of an ∞%/+100% spike.
         CASE WHEN (SELECT amt FROM tx_prior) > 0
              THEN ROUND(
                  ((SELECT amt FROM tx_current) - (SELECT amt FROM tx_prior))::numeric * 100.0
                  / (SELECT amt FROM tx_prior)::numeric
                , 1)::float
              ELSE NULL END                                                                AS revenue_change_pct,
         CASE WHEN (SELECT COUNT(*) FROM appt_prior) > 0
              THEN ROUND(((SELECT COUNT(*) FROM appt_current) - (SELECT COUNT(*) FROM appt_prior)) * 100.0
                         / (SELECT COUNT(*) FROM appt_prior), 1)::float
              ELSE NULL END                                                                AS bookings_change_pct`,
      [vendorId],
    );
  },

  async getRevenueSeries(vendorId: string, range: string) {
    const interval = intervalForRange(range);
    // Generate a full date series so every day shows even if there are no appointments
    const result = await query(
      `WITH date_series AS (
         SELECT generate_series(
           (NOW() AT TIME ZONE '${TZ}')::date - '${interval}'::interval,
           (NOW() AT TIME ZONE '${TZ}')::date,
           '1 day'::interval
         )::date AS day
       )
       SELECT
         TO_CHAR(ds.day, 'YYYY-MM-DD') AS date,
         COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'completed'), 0)::float AS revenue,
         COUNT(a.id)::int AS appointments
       FROM date_series ds
       LEFT JOIN public.appointments a
         ON (a.start_time AT TIME ZONE '${TZ}')::date = ds.day
         AND a.vendor_id = $1
       LEFT JOIN public.transactions t ON t.appointment_id = a.id
       GROUP BY ds.day
       ORDER BY ds.day`,
      [vendorId],
    );
    return result.rows;
  },

  async getBookingTrends(vendorId: string, range: string) {
    const interval = intervalForRange(range);
    const result = await query(
      `WITH date_series AS (
         SELECT generate_series(
           (NOW() AT TIME ZONE '${TZ}')::date - '${interval}'::interval,
           (NOW() AT TIME ZONE '${TZ}')::date,
           '1 day'::interval
         )::date AS day
       )
       SELECT
         TO_CHAR(ds.day, 'YYYY-MM-DD') AS date,
         COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE a.status = 'no_show')::int   AS no_show,
         COUNT(a.id)::int                                     AS total
       FROM date_series ds
       LEFT JOIN public.appointments a
         ON (a.start_time AT TIME ZONE '${TZ}')::date = ds.day
         AND a.vendor_id = $1
       GROUP BY ds.day
       ORDER BY ds.day`,
      [vendorId],
    );
    return result.rows;
  },

  async getStaffPerformance(vendorId: string, range: string, limit: number) {
    const interval = intervalForRange(range);
    // vendorId is business_account_id; join through salon_locations
    const result = await query(
      `SELECT
         sm.id AS staff_id,
         COALESCE(u.first_name || ' ' || u.last_name, u.email) AS staff_name,
         sm.role,
         COUNT(a.id)::int                                                    AS total_bookings,
         COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'completed'), 0)::float AS total_revenue,
         COALESCE(AVG(r.rating), 0)::float                                   AS avg_rating,
         CASE WHEN COUNT(a.id) > 0
              THEN ROUND(COUNT(a.id) FILTER (WHERE a.status = 'completed') * 100.0 / COUNT(a.id), 1)
              ELSE 0 END::float                                               AS completion_rate,
         COALESCE(SUM(t.amount * sm.commission_percentage / 100) FILTER (WHERE t.status = 'completed'), 0)::float AS commission_earned
       FROM public.staff_members sm
       JOIN public.users u ON sm.user_id = u.id
       JOIN public.salon_locations sl ON sm.employer_id = sl.id
       LEFT JOIN public.appointments a ON a.staff_member_id = sm.id
         AND a.start_time >= NOW() - interval '${interval}'
       LEFT JOIN public.transactions t ON t.appointment_id = a.id AND t.status = 'completed'
       LEFT JOIN public.reviews r ON r.appointment_id = a.id
       WHERE sl.business_account_id = $1 AND sm.is_active = TRUE
       GROUP BY sm.id, u.first_name, u.last_name, u.email, sm.role, sm.commission_percentage
       ORDER BY total_revenue DESC
       LIMIT $2`,
      [vendorId, limit],
    );
    return result.rows;
  },

  async getTopServices(vendorId: string, range: string, limit: number) {
    const interval = intervalForRange(range);
    const result = await query(
      `WITH service_stats AS (
         SELECT
           s.id AS service_id,
           s.name AS service_name,
           s.category,
           COUNT(a.id)::int AS booking_count,
           COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'completed'), 0)::float AS total_revenue
         FROM public.appointments a
         JOIN public.services s ON a.service_id = s.id
         LEFT JOIN public.transactions t ON t.appointment_id = a.id
         WHERE a.vendor_id = $1 AND a.status = 'completed'
           AND a.start_time >= NOW() - interval '${interval}'
         GROUP BY s.id, s.name, s.category
       ),
       total AS (SELECT COALESCE(SUM(total_revenue), 0) AS grand_total FROM service_stats)
       SELECT
         ss.*,
         CASE WHEN t.grand_total > 0
              THEN ROUND((ss.total_revenue / t.grand_total * 100)::numeric, 1)::float
              ELSE 0 END AS revenue_share_pct
       FROM service_stats ss, total t
       ORDER BY ss.booking_count DESC
       LIMIT $2`,
      [vendorId, limit],
    );
    return result.rows;
  },

  async getCustomerInsights(vendorId: string, range: string) {
    const interval = intervalForRange(range);

    const summary = await queryOne(
      `WITH period_customers AS (
         SELECT DISTINCT customer_id FROM public.appointments
         WHERE vendor_id = $1 AND status = 'completed'
           AND start_time >= NOW() - interval '${interval}'
       ),
       prior_customers AS (
         SELECT DISTINCT customer_id FROM public.appointments
         WHERE vendor_id = $1 AND status = 'completed'
           AND start_time < NOW() - interval '${interval}'
       )
       SELECT
         (SELECT COUNT(*) FROM period_customers)::int AS total_customers,
         (SELECT COUNT(*) FROM period_customers pc WHERE pc.customer_id NOT IN (SELECT customer_id FROM prior_customers))::int AS new_customers,
         (SELECT COUNT(*) FROM period_customers pc WHERE pc.customer_id IN (SELECT customer_id FROM prior_customers))::int AS returning_customers`,
      [vendorId],
    );

    const topCustomers = await query(
      `SELECT a.customer_id, COALESCE(cp.first_name, u.email) AS first_name,
              COUNT(a.id)::int AS visit_count,
              COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'completed'), 0)::float AS total_spent
       FROM public.appointments a
       LEFT JOIN public.customer_profiles cp ON a.customer_id = cp.user_id
       JOIN public.users u ON a.customer_id = u.id
       LEFT JOIN public.transactions t ON t.appointment_id = a.id
       WHERE a.vendor_id = $1 AND a.status = 'completed'
         AND a.start_time >= NOW() - interval '${interval}'
       GROUP BY a.customer_id, cp.first_name, u.email
       ORDER BY total_spent DESC
       LIMIT 10`,
      [vendorId],
    );

    const total = summary?.total_customers ?? 0;
    return {
      ...summary,
      avg_visits_per_customer: 0,
      churn_rate: 0,
      retention_rate: total > 0
        ? Math.round(((summary?.returning_customers ?? 0) / total) * 100)
        : 0,
      top_customers: topCustomers.rows,
    };
  },
};
