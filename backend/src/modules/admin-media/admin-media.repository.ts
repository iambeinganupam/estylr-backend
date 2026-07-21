// ─────────────────────────────────────────────────────────────────────────────
// Admin Media — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { MediaListQuery, MediaUpdateBody } from './admin-media.schemas';

export interface MediaRow {
  id: string;
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  uploaded_by: string;
  uploader_email: string | null;
  file_url: string;
  file_key: string;
  mime_type: string;
  file_size: number;
  title: string | null;
  description: string | null;
  caption: string | null;
  media_type: string;
  is_featured: boolean;
  is_public: boolean;
  sort_order: number;
  created_at: string;
}

const VENDOR_NAME_SQL = `
  CASE WHEN m.vendor_type = 'freelancer'
       THEN (SELECT business_name FROM public.freelancer_profiles WHERE id = m.vendor_id)
       ELSE (SELECT display_name  FROM public.salon_locations    WHERE id = m.vendor_id)
  END
`;

export const adminMediaRepository = {
  async list(q: MediaListQuery): Promise<{ rows: MediaRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.vendor_id)   push('m.vendor_id = ?', q.vendor_id);
    if (q.vendor_type) push('m.vendor_type = ?', q.vendor_type);
    if (q.media_type && q.media_type !== 'all') push('m.media_type = ?', q.media_type);
    if (q.is_public !== undefined)   push('m.is_public = ?', q.is_public);
    if (q.is_featured !== undefined) push('m.is_featured = ?', q.is_featured);
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(`(m.created_at, m.id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<MediaRow>(
      `SELECT m.id, m.vendor_type, m.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              m.uploaded_by, u.email AS uploader_email,
              m.file_url, m.file_key, m.mime_type, m.file_size,
              m.title, m.description, m.caption,
              m.media_type::text AS media_type,
              m.is_featured, m.is_public, m.sort_order,
              m.created_at
       FROM public.media_items m
       LEFT JOIN public.users u ON u.id = m.uploaded_by
       ${where}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${limitParam}`,
      params,
    );
    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<MediaRow | null> {
    return queryOne<MediaRow>(
      `SELECT m.id, m.vendor_type, m.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              m.uploaded_by, u.email AS uploader_email,
              m.file_url, m.file_key, m.mime_type, m.file_size,
              m.title, m.description, m.caption,
              m.media_type::text AS media_type,
              m.is_featured, m.is_public, m.sort_order,
              m.created_at
       FROM public.media_items m
       LEFT JOIN public.users u ON u.id = m.uploaded_by
       WHERE m.id = $1`,
      [id],
    );
  },

  async update(id: string, patch: MediaUpdateBody): Promise<void> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    if (patch.is_public !== undefined)   { params.push(patch.is_public);   sets.push(`is_public = $${params.length}`); }
    if (patch.is_featured !== undefined) { params.push(patch.is_featured); sets.push(`is_featured = $${params.length}`); }
    if (patch.caption !== undefined)     { params.push(patch.caption);     sets.push(`caption = $${params.length}`); }
    if (sets.length === 1) return;
    params.push(id);
    try {
      await query(`UPDATE public.media_items SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    } catch (e) { mapPgError(e); }
  },

  async delete(id: string): Promise<void> {
    // Hard delete — admin-driven removal. The actual storage object is
    // cleaned up by a downstream job using `file_key` (out of scope for v1).
    try {
      await query(`DELETE FROM public.media_items WHERE id = $1`, [id]);
    } catch (e) { mapPgError(e); }
  },
};
