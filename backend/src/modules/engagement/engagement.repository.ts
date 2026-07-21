// ─────────────────────────────────────────────────────────────────────────────
// Engagement Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne, withTransaction } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';

export const engagementRepository = {
  // ── Reviews ──
  async findExistingReview(customerId: string, appointmentId: string) {
    return queryOne(
      `SELECT id FROM public.reviews WHERE customer_id = $1 AND appointment_id = $2`,
      [customerId, appointmentId],
    );
  },

  async createReview(customerId: string, appointmentId: string, rating: number, comment?: string) {
    try {
      return await queryOne(
        `INSERT INTO public.reviews (customer_id, vendor_type, vendor_id, appointment_id, rating, comment)
         SELECT $1, a.vendor_type, a.vendor_id, $2, $3, $4
         FROM public.appointments a WHERE a.id = $2
         RETURNING *`,
        [customerId, appointmentId, rating, comment || null],
      );
    } catch (e) { mapPgError(e); }
  },

  async replyToReview(reviewId: string, vendorId: string, replyText: string) {
    try {
      return await queryOne(
        `UPDATE public.reviews SET vendor_reply = $2, vendor_reply_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND vendor_id = $3 RETURNING *`,
        [reviewId, replyText, vendorId],
      );
    } catch (e) { mapPgError(e); }
  },

  async getPendingReviews(customerId: string) {
    const result = await query(
      `SELECT a.id AS appointment_id, a.start_time, a.vendor_type, a.vendor_id, s.name AS service_name
       FROM public.appointments a
       JOIN public.services s ON a.service_id = s.id
       LEFT JOIN public.reviews r ON r.appointment_id = a.id
       WHERE a.customer_id = $1 AND a.status = 'completed' AND r.id IS NULL
       ORDER BY a.start_time DESC`,
      [customerId],
    );
    return result.rows;
  },

  async deleteReview(reviewId: string, customerId: string) {
    try {
      return await queryOne(
        `DELETE FROM public.reviews WHERE id = $1 AND customer_id = $2 RETURNING *`,
        [reviewId, customerId],
      );
    } catch (e) { mapPgError(e); }
  },

  // List visible reviews for a vendor, newest first. JOINs the customer's profile
  // for `author_name` (falls back to email local-part) and surfaces vendor_reply
  // fields so the salon dashboard can show an "Already replied" badge.
  async listVendorReviews(
    vendorType: string,
    vendorId: string,
    limit: number,
  ) {
    const result = await query(
      `SELECT r.id, r.rating, r.comment, r.vendor_reply, r.vendor_reply_at, r.created_at,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', cp.first_name, cp.last_name)), ''),
                       SPLIT_PART(u.email, '@', 1)) AS author_name
         FROM public.reviews r
         JOIN public.users u ON u.id = r.customer_id
         LEFT JOIN public.customer_profiles cp ON cp.user_id = r.customer_id
        WHERE r.vendor_type = $1 AND r.vendor_id = $2 AND r.is_visible = TRUE
        ORDER BY r.created_at DESC
        LIMIT $3`,
      [vendorType, vendorId, limit],
    );
    return result.rows;
  },

  // Aggregated rating distribution for the vendor — drives the
  // "5★ ▓▓▓░░ 12" breakdown without re-pulling rows client-side.
  async getVendorRatingSummary(vendorType: string, vendorId: string) {
    return queryOne<{
      total_count: number; avg_rating: number;
      rating_5: number; rating_4: number; rating_3: number; rating_2: number; rating_1: number;
    }>(
      `SELECT COUNT(*)::int                            AS total_count,
              COALESCE(AVG(rating), 0)::float          AS avg_rating,
              COUNT(*) FILTER (WHERE rating = 5)::int  AS rating_5,
              COUNT(*) FILTER (WHERE rating = 4)::int  AS rating_4,
              COUNT(*) FILTER (WHERE rating = 3)::int  AS rating_3,
              COUNT(*) FILTER (WHERE rating = 2)::int  AS rating_2,
              COUNT(*) FILTER (WHERE rating = 1)::int  AS rating_1
         FROM public.reviews
        WHERE vendor_type = $1 AND vendor_id = $2 AND is_visible = TRUE`,
      [vendorType, vendorId],
    );
  },

  // ── Favorites ──
  async toggleFavorite(customerId: string, vendorType: string, vendorId: string) {
    try {
      // Try to delete first — if a row was deleted, it was unfavorited
      const deleted = await queryOne(
        `DELETE FROM public.favorites WHERE customer_id = $1 AND vendor_type = $2 AND vendor_id = $3 RETURNING id`,
        [customerId, vendorType, vendorId],
      );
      if (deleted) return { is_favorited: false };

      // Otherwise insert
      await queryOne(
        `INSERT INTO public.favorites (customer_id, vendor_type, vendor_id) VALUES ($1, $2, $3) RETURNING id`,
        [customerId, vendorType, vendorId],
      );
      return { is_favorited: true };
    } catch (e) { mapPgError(e); }
  },

  async listFavorites(customerId: string) {
    // url_slug isn't in mv_vendor_discovery (008_discovery_mv), so we pull it
    // from the source tables via two LEFT JOINs and coalesce. This lets the
    // customer portal's /dashboard/favorites cards link directly to the
    // vendor detail page at /vendors/[slug].
    const result = await query(
      `SELECT f.id, f.vendor_type, f.vendor_id, f.created_at,
              COALESCE(v.display_name, v.business_name, 'Vendor') AS vendor_name,
              v.logo_url,
              v.avg_rating,
              COALESCE(fp.url_slug, sl.url_slug) AS url_slug
       FROM public.favorites f
       LEFT JOIN public.mv_vendor_discovery v
              ON f.vendor_type = v.vendor_type AND f.vendor_id = v.id
       LEFT JOIN public.freelancer_profiles fp
              ON f.vendor_type = 'freelancer' AND fp.id = f.vendor_id
       LEFT JOIN public.salon_locations sl
              ON f.vendor_type = 'salon_location' AND sl.id = f.vendor_id
       WHERE f.customer_id = $1
       ORDER BY f.created_at DESC`,
      [customerId],
    );
    return result.rows;
  },

  // ── Notifications ──
  async listNotifications(userId: string, isRead?: boolean, limit: number = 50) {
    const conditions = ['n.user_id = $1'];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (isRead !== undefined) {
      conditions.push(`n.is_read = $${paramIdx++}`);
      params.push(isRead);
    }

    const result = await query(
      `SELECT n.* FROM public.notifications n
       WHERE ${conditions.join(' AND ')}
       ORDER BY n.created_at DESC LIMIT $${paramIdx}`,
      [...params, limit],
    );
    return result.rows;
  },

  async markNotificationRead(notificationId: string, userId: string) {
    try {
      return await queryOne(
        `UPDATE public.notifications SET is_read = TRUE, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [notificationId, userId],
      );
    } catch (e) { mapPgError(e); }
  },

  async markAllRead(userId: string) {
    try {
      await query(
        `UPDATE public.notifications SET is_read = TRUE, updated_at = NOW()
         WHERE user_id = $1 AND is_read = FALSE`,
        [userId],
      );
    } catch (e) { mapPgError(e); }
  },

  async getUnreadCount(userId: string): Promise<number> {
    const row = await queryOne(
      `SELECT COUNT(*)::int AS count FROM public.notifications WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
    return row?.count ?? 0;
  },

  // ── Skill Endorsements ──
  async getSkillWithOwner(skillId: string) {
    return queryOne<{
      id: string;
      freelancer_id: string;
      owner_user_id: string;
      endorsement_count: number;
    }>(
      `SELECT s.id, s.freelancer_id, fp.user_id AS owner_user_id, s.endorsement_count
         FROM public.freelancer_skills s
         JOIN public.freelancer_profiles fp ON fp.id = s.freelancer_id
        WHERE s.id = $1`,
      [skillId],
    );
  },

  async endorseSkill(skillId: string, endorserId: string): Promise<{ created: boolean }> {
    try {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO public.freelancer_skill_endorsements (skill_id, endorser_id)
         VALUES ($1, $2)
         ON CONFLICT (skill_id, endorser_id) DO NOTHING
         RETURNING id`,
        [skillId, endorserId],
      );
      return { created: !!row };
    } catch (e) { mapPgError(e); }
  },

  async unendorseSkill(skillId: string, endorserId: string): Promise<{ removed: boolean }> {
    try {
      const result = await query(
        `DELETE FROM public.freelancer_skill_endorsements
          WHERE skill_id = $1 AND endorser_id = $2`,
        [skillId, endorserId],
      );
      return { removed: (result.rowCount ?? 0) > 0 };
    } catch (e) { mapPgError(e); }
  },

  async hasEndorsedSkill(skillId: string, endorserId: string): Promise<boolean> {
    const row = await queryOne(
      `SELECT 1 FROM public.freelancer_skill_endorsements
        WHERE skill_id = $1 AND endorser_id = $2`,
      [skillId, endorserId],
    );
    return !!row;
  },

  async getSkillEndorsementCount(skillId: string): Promise<number> {
    const row = await queryOne<{ endorsement_count: number }>(
      `SELECT endorsement_count FROM public.freelancer_skills WHERE id = $1`,
      [skillId],
    );
    return Number(row?.endorsement_count ?? 0);
  },

  // ── Polymorphic Reviews (R1) ──
  async countCompletedAppointmentsForTarget({
    userId, kind, targetId,
  }: { userId: string; kind: 'vendor'|'service_line'|'product'; targetId: string }): Promise<number> {
    if (kind === 'vendor') {
      const r = await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM public.appointments a
          WHERE a.customer_id = $1
            AND a.vendor_id   = $2
            AND a.status      = 'completed'`,
        [userId, targetId],
      );
      return Number(r?.n ?? 0);
    }
    if (kind === 'service_line') {
      const r = await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM public.appointments a
          WHERE a.customer_id = $1
            AND a.service_id  = $2
            AND a.status      = 'completed'`,
        [userId, targetId],
      );
      return Number(r?.n ?? 0);
    }
    // product: always 0 — eligibility helper short-circuits via env flag in R1.
    return 0;
  },

  async resolveVendorForTarget({
    kind, targetId,
  }: { kind: 'vendor'|'service_line'|'product'; targetId: string }): Promise<{ vendorId: string; vendorType: 'freelancer'|'salon_location' } | null> {
    if (kind === 'vendor') {
      const fr = await queryOne<{ id: string }>(`SELECT id FROM public.freelancer_profiles WHERE id = $1`, [targetId]);
      if (fr) return { vendorId: targetId, vendorType: 'freelancer' };
      const sl = await queryOne<{ id: string }>(`SELECT id FROM public.salon_locations WHERE id = $1`, [targetId]);
      if (sl) return { vendorId: targetId, vendorType: 'salon_location' };
      return null;
    }
    if (kind === 'service_line') {
      const r = await queryOne<{ vendor_id: string; vendor_type: string }>(
        `SELECT vendor_id, vendor_type FROM public.services WHERE id = $1 AND is_active = TRUE`,
        [targetId],
      );
      return r ? { vendorId: r.vendor_id, vendorType: r.vendor_type as 'freelancer'|'salon_location' } : null;
    }
    const r = await queryOne<{ vendor_id: string; vendor_type: string }>(
      `SELECT vendor_id, vendor_type FROM public.vendor_products WHERE id = $1 AND is_active = TRUE`,
      [targetId],
    );
    return r ? { vendorId: r.vendor_id, vendorType: r.vendor_type as 'freelancer'|'salon_location' } : null;
  },

  async insertReview(input: {
    customerId: string;
    vendorId: string;
    vendorType: 'freelancer'|'salon_location';
    targetKind: 'vendor'|'service_line'|'product'; targetId: string;
    appointmentId: string;
    rating: number; title?: string; comment?: string;
    photos: Array<{url:string;w:number;h:number}>;
  }) {
    const sql = `
      INSERT INTO public.reviews (
        customer_id, vendor_type, vendor_id,
        target_kind, target_id,
        appointment_id, rating, title, comment, photos
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      RETURNING id, customer_id, vendor_type, vendor_id, target_kind, target_id,
                appointment_id, rating, title, comment, photos, helpful_count, created_at`;
    return queryOne<any>(sql, [
      input.customerId, input.vendorType, input.vendorId,
      input.targetKind, input.targetId,
      input.appointmentId, input.rating,
      input.title ?? null, input.comment ?? null,
      JSON.stringify(input.photos),
    ]);
  },

  async listReviews(args: {
    targetKind: 'vendor'|'service_line'|'product'; targetId: string;
    sort: 'recent'|'helpful'|'rating_high'|'rating_low';
    withPhotos: boolean; limit: number; cursor: { score: number; id: string } | null;
  }) {
    const sortConfig = {
      helpful:     { col: 'helpful_count',                       dir: 'DESC' as const, scoreField: 'helpful_count' },
      rating_high: { col: 'rating',                              dir: 'DESC' as const, scoreField: 'rating' },
      rating_low:  { col: 'rating',                              dir: 'ASC'  as const, scoreField: 'rating' },
      recent:      { col: 'EXTRACT(EPOCH FROM created_at)',       dir: 'DESC' as const, scoreField: 'sort_recent' },
    }[args.sort];
    const order = `${sortConfig.col} ${sortConfig.dir}, id ${sortConfig.dir}`;
    const photoFilter = args.withPhotos ? 'AND jsonb_array_length(photos) > 0' : '';
    const cursorFilter = args.cursor
      ? `AND (${sortConfig.col}, id) ${sortConfig.dir === 'DESC' ? '<' : '>'} ($4, $5)`
      : '';
    const sql = `
      SELECT id, customer_id, rating, title, comment, photos, helpful_count, created_at,
             EXTRACT(EPOCH FROM created_at)::numeric AS sort_recent
        FROM public.reviews
       WHERE target_kind = $1 AND target_id = $2 AND is_visible = TRUE
             ${photoFilter} ${cursorFilter}
       ORDER BY ${order}
       LIMIT $3`;
    const params: unknown[] = [args.targetKind, args.targetId, args.limit + 1];
    if (args.cursor) params.push(args.cursor.score, args.cursor.id);
    const rows = await query<any>(sql, params);
    return { rows: rows.rows, scoreField: sortConfig.scoreField };
  },

  async toggleHelpful(reviewId: string, userId: string): Promise<{ helpful_count: number; voted: boolean }> {
    return withTransaction(async (c) => {
      const ins = await c.query(
        `INSERT INTO public.review_helpful_votes(user_id, review_id) VALUES ($1, $2)
           ON CONFLICT (user_id, review_id) DO NOTHING RETURNING review_id`,
        [userId, reviewId],
      );
      if (ins.rowCount && ins.rowCount > 0) {
        const r = await c.query(
          `UPDATE public.reviews SET helpful_count = helpful_count + 1 WHERE id = $1 RETURNING helpful_count`,
          [reviewId],
        );
        return { helpful_count: r.rows[0].helpful_count, voted: true };
      }
      await c.query(
        `DELETE FROM public.review_helpful_votes WHERE user_id = $1 AND review_id = $2`,
        [userId, reviewId],
      );
      const r = await c.query(
        `UPDATE public.reviews SET helpful_count = GREATEST(helpful_count - 1, 0) WHERE id = $1 RETURNING helpful_count`,
        [reviewId],
      );
      return { helpful_count: r.rows[0].helpful_count, voted: false };
    });
  },

  async insertReport(input: { reviewId: string; reporterId: string; reason: string }) {
    return queryOne<{ id: string }>(
      `INSERT INTO public.review_reports(review_id, reporter_id, reason) VALUES ($1,$2,$3) RETURNING id`,
      [input.reviewId, input.reporterId, input.reason],
    );
  },

  async reviewAggregates({
    targetKind, targetIds,
  }: { targetKind: 'vendor'|'service_line'|'product'; targetIds: string[] }) {
    const sql = `
      SELECT target_id,
             COALESCE(AVG(rating)::numeric(3,2), 0) AS rating_avg,
             COUNT(*)::int                          AS rating_count,
             COUNT(*) FILTER (WHERE rating = 5)::int AS r5,
             COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
             COUNT(*) FILTER (WHERE rating = 3)::int AS r3,
             COUNT(*) FILTER (WHERE rating = 2)::int AS r2,
             COUNT(*) FILTER (WHERE rating = 1)::int AS r1,
             COUNT(*) FILTER (WHERE jsonb_array_length(photos) > 0)::int AS photo_count
        FROM public.reviews
       WHERE target_kind = $1 AND target_id = ANY($2::uuid[]) AND is_visible = TRUE
       GROUP BY target_id`;
    const rows = await query<any>(sql, [targetKind, targetIds]);
    return rows.rows;
  },
};
