// ─────────────────────────────────────────────────────────────────────────────
// Admin Reviews — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { ReviewListQuery } from './admin-reviews.schemas';

export interface ReviewRow {
  id: string;
  customer_id: string;
  customer_email: string | null;
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  appointment_id: string;
  rating: number;
  comment: string | null;
  vendor_reply: string | null;
  vendor_reply_at: string | null;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

const VENDOR_NAME_SQL = `
  CASE WHEN r.vendor_type = 'freelancer'
       THEN (SELECT business_name FROM public.freelancer_profiles WHERE id = r.vendor_id)
       ELSE (SELECT display_name  FROM public.salon_locations    WHERE id = r.vendor_id)
  END
`;

export const adminReviewsRepository = {
  async list(q: ReviewListQuery): Promise<{ rows: ReviewRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.vendor_id)   push('r.vendor_id = ?', q.vendor_id);
    if (q.vendor_type) push('r.vendor_type = ?', q.vendor_type);
    if (q.customer_id) push('r.customer_id = ?', q.customer_id);
    if (q.is_visible !== undefined) push('r.is_visible = ?', q.is_visible);
    if (q.rating_min !== undefined) push('r.rating >= ?', q.rating_min);
    if (q.rating_max !== undefined) push('r.rating <= ?', q.rating_max);
    if (q.from)        push('r.created_at >= ?', q.from);
    if (q.to)          push('r.created_at <= ?', q.to);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(`LOWER(COALESCE(r.comment, '')) LIKE ${p}`);
    }
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(`(r.created_at, r.id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<ReviewRow>(
      `SELECT r.id, r.customer_id, u.email AS customer_email,
              r.vendor_type, r.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              r.appointment_id,
              r.rating, r.comment,
              r.vendor_reply, r.vendor_reply_at,
              r.is_visible,
              r.created_at, r.updated_at
       FROM public.reviews r
       JOIN public.users u ON u.id = r.customer_id
       ${where}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${limitParam}`,
      params,
    );
    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<ReviewRow | null> {
    return queryOne<ReviewRow>(
      `SELECT r.id, r.customer_id, u.email AS customer_email,
              r.vendor_type, r.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              r.appointment_id,
              r.rating, r.comment,
              r.vendor_reply, r.vendor_reply_at,
              r.is_visible,
              r.created_at, r.updated_at
       FROM public.reviews r
       JOIN public.users u ON u.id = r.customer_id
       WHERE r.id = $1`,
      [id],
    );
  },

  async setVisible(id: string, visible: boolean): Promise<void> {
    try {
      await query(`UPDATE public.reviews SET is_visible = $1, updated_at = NOW() WHERE id = $2`, [visible, id]);
    } catch (e) { mapPgError(e); }
  },
};
