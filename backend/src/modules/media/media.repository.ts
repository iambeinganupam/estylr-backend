// ─────────────────────────────────────────────────────────────────────────────
// Media Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';

const SELECT_WITH_SERVICE = `
  SELECT m.*,
         s.id           AS svc_id,
         s.name         AS svc_name,
         s.category_id  AS svc_category_id,
         s.category     AS svc_category_text,
         sc.name        AS svc_category_name
  FROM public.media_items m
  LEFT JOIN public.services s            ON s.id = m.service_id
  LEFT JOIN public.service_categories sc ON sc.id = s.category_id
`;

export const mediaRepository = {
  async create(data: {
    vendorType: string; vendorId: string; fileUrl: string; fileKey: string;
    mimeType: string; fileSize: number; title?: string; description?: string;
    caption?: string; mediaType: string; isPublic: boolean; isFeatured: boolean;
    uploadedBy: string; serviceId?: string | null;
  }) {
    try {
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO public.media_items
         (vendor_type, vendor_id, file_url, file_key, mime_type, file_size, title, description, caption, media_type, is_public, is_featured, uploaded_by, service_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [data.vendorType, data.vendorId, data.fileUrl, data.fileKey, data.mimeType,
         data.fileSize, data.title || null, data.description || null, data.caption || null,
         data.mediaType, data.isPublic, data.isFeatured, data.uploadedBy, data.serviceId ?? null],
      );
      if (!inserted) return null;
      return queryOne(`${SELECT_WITH_SERVICE} WHERE m.id = $1`, [inserted.id]);
    } catch (e) { mapPgError(e); }
  },

  async listByVendor(
    vendorType: string,
    vendorId: string,
    filters: { categoryId?: string; serviceId?: string } = {},
  ) {
    // KYC documents are uploaded through the same /media/portfolio endpoint
    // (shared multipart pipeline → Cloudinary), but they MUST NOT surface in
    // the vendor-visible gallery — that's a privacy + UX leak. Filtering at
    // the SQL layer is the cheapest place to enforce it.
    const where: string[] = ['m.vendor_type = $1', 'm.vendor_id = $2', "m.media_type <> 'kyc'"];
    const params: unknown[] = [vendorType, vendorId];
    if (filters.categoryId) {
      params.push(filters.categoryId);
      where.push(`s.category_id = $${params.length}`);
    }
    if (filters.serviceId) {
      params.push(filters.serviceId);
      where.push(`m.service_id = $${params.length}`);
    }
    const result = await query(
      `${SELECT_WITH_SERVICE}
       WHERE ${where.join(' AND ')}
       ORDER BY m.sort_order ASC, m.created_at DESC`,
      params,
    );
    return result.rows;
  },

  async findById(mediaId: string, vendorType: string, vendorId: string) {
    return queryOne(
      `${SELECT_WITH_SERVICE}
       WHERE m.id = $1 AND m.vendor_type = $2 AND m.vendor_id = $3`,
      [mediaId, vendorType, vendorId],
    );
  },

  async countByService(vendorType: string, vendorId: string, serviceId: string) {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.media_items
       WHERE vendor_type = $1 AND vendor_id = $2 AND service_id = $3`,
      [vendorType, vendorId, serviceId],
    );
    return Number(row?.count ?? 0);
  },

  async update(mediaId: string, vendorType: string, vendorId: string, data: {
    caption?: string; isFeatured?: boolean; sortOrder?: number; isPublic?: boolean;
    serviceId?: string | null;
  }) {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [mediaId, vendorType, vendorId];
    let paramIdx = 4;

    if (data.caption !== undefined) { setClauses.push(`caption = $${paramIdx++}`); values.push(data.caption); }
    if (data.isFeatured !== undefined) { setClauses.push(`is_featured = $${paramIdx++}`); values.push(data.isFeatured); }
    if (data.sortOrder !== undefined) { setClauses.push(`sort_order = $${paramIdx++}`); values.push(data.sortOrder); }
    if (data.isPublic !== undefined) { setClauses.push(`is_public = $${paramIdx++}`); values.push(data.isPublic); }
    if (data.serviceId !== undefined) { setClauses.push(`service_id = $${paramIdx++}`); values.push(data.serviceId); }

    // When setting featured, unfeature all others first
    try {
      if (data.isFeatured === true) {
        await query(
          `UPDATE public.media_items SET is_featured = FALSE WHERE vendor_type = $1 AND vendor_id = $2 AND id != $3`,
          [vendorType, vendorId, mediaId],
        );
      }

      await query(
        `UPDATE public.media_items SET ${setClauses.join(', ')}
         WHERE id = $1 AND vendor_type = $2 AND vendor_id = $3`,
        values,
      );
    } catch (e) { mapPgError(e); }
    return queryOne(
      `${SELECT_WITH_SERVICE}
       WHERE m.id = $1 AND m.vendor_type = $2 AND m.vendor_id = $3`,
      [mediaId, vendorType, vendorId],
    );
  },

  async delete(mediaId: string) {
    try {
      return await queryOne(`DELETE FROM public.media_items WHERE id = $1 RETURNING *`, [mediaId]);
    } catch (e) { mapPgError(e); }
  },
};
