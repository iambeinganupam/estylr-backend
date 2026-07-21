// ─────────────────────────────────────────────────────────────────────────────
// Public Stats Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { queryOne } from '../../config/database';

export interface PublicStatsRow {
  vendor_count:             number;
  city_count:               number;
  completed_booking_count:  number;
  average_rating:           number;
}

export const publicStatsRepository = {
  async getStats(): Promise<PublicStatsRow> {
    // Single round-trip; each subquery is an indexed COUNT/AVG, cheap on
    // current data volumes. If volume grows past ~1M rows, swap to a
    // materialized view refreshed by the existing cron in src/jobs/.
    const row = await queryOne<{
      vendor_count: string;
      city_count: string;
      completed_booking_count: string;
      average_rating: string | null;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM public.freelancer_profiles WHERE is_verified = TRUE AND is_active = TRUE)
         + (SELECT COUNT(*) FROM public.salon_locations WHERE is_verified = TRUE AND is_active = TRUE)
         AS vendor_count,
         (
           SELECT COUNT(DISTINCT city) FROM (
             SELECT city FROM public.freelancer_profiles WHERE is_verified = TRUE AND is_active = TRUE AND city IS NOT NULL
             UNION
             SELECT city FROM public.salon_locations    WHERE is_verified = TRUE AND is_active = TRUE AND city IS NOT NULL
           ) cities
         ) AS city_count,
         (SELECT COUNT(*) FROM public.appointments WHERE status = 'completed') AS completed_booking_count,
         (SELECT ROUND(AVG(rating)::numeric, 1)::text FROM public.reviews) AS average_rating`,
      [],
    );

    return {
      vendor_count:            Number(row?.vendor_count ?? 0),
      city_count:              Number(row?.city_count ?? 0),
      completed_booking_count: Number(row?.completed_booking_count ?? 0),
      average_rating:          row?.average_rating ? Number(row.average_rating) : 0,
    };
  },
};
