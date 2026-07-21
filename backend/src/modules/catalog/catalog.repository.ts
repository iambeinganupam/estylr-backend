// ─────────────────────────────────────────────────────────────────────────────
// Catalog Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';

export const catalogRepository = {
  async listServices(vendorType: string, vendorId: string, filters?: { category?: string; gender?: string; active?: string }) {
    let whereExtra = '';
    const params: unknown[] = [vendorType, vendorId];
    let paramIdx = 3;

    if (filters?.category) {
      whereExtra += ` AND s.category = $${paramIdx++}`;
      params.push(filters.category);
    }
    if (filters?.gender) {
      whereExtra += ` AND s.gender_target = $${paramIdx++}`;
      params.push(filters.gender);
    }
    if (filters?.active !== undefined) {
      whereExtra += ` AND s.is_active = $${paramIdx++}`;
      params.push(filters.active === 'true');
    } else {
      // Default: exclude soft-deleted services
      whereExtra += ` AND s.is_active = TRUE`;
    }

    const result = await query(
      `SELECT s.* FROM public.services s
       WHERE s.vendor_type = $1 AND s.vendor_id = $2 ${whereExtra}
       ORDER BY s.category, s.name`,
      params,
    );
    return result.rows;
  },

  async createService(vendorType: string, vendorId: string, data: Record<string, unknown>) {
    // `inclusions` is a JSONB column; serialise the array if provided, else
    // fall back to the column's `'[]'::jsonb` default by passing null.
    const inclusionsJson = Array.isArray(data.inclusions)
      ? JSON.stringify(data.inclusions)
      : null;
    try {
      // category_id is the FK into service_categories — resolved upstream
      // in catalog.service from the (category, subcategory) name pair so
      // analytics can join the taxonomy table directly.
      return await queryOne(
        `INSERT INTO public.services (
           vendor_type, vendor_id, name, description, duration_minutes, price,
           category, category_id, gender_target, is_active, inclusions,
           service_location
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::jsonb, '[]'::jsonb), $12)
         RETURNING *`,
        [
          vendorType, vendorId, data.name, data.description || null,
          data.duration_minutes, data.price, data.category || null,
          data.category_id || null,
          data.gender_target, data.is_active ?? true, inclusionsJson,
          data.service_location ?? 'onsite',
        ],
      );
    } catch (e) { mapPgError(e); }
  },

  async getServiceById(serviceId: string, vendorType: string, vendorId: string) {
    return queryOne(
      `SELECT * FROM public.services WHERE id = $1 AND vendor_type = $2 AND vendor_id = $3`,
      [serviceId, vendorType, vendorId],
    );
  },

  async updateService(serviceId: string, vendorType: string, vendorId: string, fields: Record<string, unknown>) {
    // Matches updateServiceSchema: name, description, duration_minutes, price,
    // category, gender_target, is_active, is_trending, is_featured, inclusions.
    // inclusions is JSONB — serialise the array to a JSON string so pg sends text,
    // not a Postgres array literal.
    const ALLOWED_FIELDS = [
      'name', 'description', 'duration_minutes', 'price', 'category', 'category_id',
      'gender_target', 'is_active', 'is_trending', 'is_featured', 'inclusions',
      'service_location',
    ] as const;
    const normalized: Record<string, unknown> = { ...fields };
    if (Array.isArray(normalized.inclusions)) {
      normalized.inclusions = JSON.stringify(normalized.inclusions);
    }
    // Three WHERE params ($1=id, $2=vendor_type, $3=vendor_id), so SET
    // placeholders must start at $4 — paramOffset: 3. Without this the
    // SET values overwrite WHERE bindings and Postgres throws 08P01.
    const { setClause, values } = buildUpdateSet(normalized, ALLOWED_FIELDS, { paramOffset: 3 });
    try {
      return await queryOne(
        `UPDATE public.services
         SET ${setClause}, updated_at = NOW()
         WHERE id = $1 AND vendor_type = $2 AND vendor_id = $3
         RETURNING *`,
        [serviceId, vendorType, vendorId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  async softDeleteService(serviceId: string, vendorType: string, vendorId: string) {
    try {
      return await queryOne(
        `UPDATE public.services SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1 AND vendor_type = $2 AND vendor_id = $3
         RETURNING *`,
        [serviceId, vendorType, vendorId],
      );
    } catch (e) { mapPgError(e); }
  },

  async upsertStaffOverride(serviceId: string, staffId: string, price: number | null, durationMinutes: number | null) {
    if (price === null && durationMinutes === null) {
      // Remove override
      try {
        await query(
          `DELETE FROM public.staff_service_overrides WHERE service_id = $1 AND staff_member_id = $2`,
          [serviceId, staffId],
        );
      } catch (e) { mapPgError(e); }
      return null;
    }

    try {
      return await queryOne(
        `INSERT INTO public.staff_service_overrides (service_id, staff_member_id, override_price, override_duration_minutes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (service_id, staff_member_id)
         DO UPDATE SET override_price = $3, override_duration_minutes = $4, updated_at = NOW()
         RETURNING *`,
        [serviceId, staffId, price, durationMinutes],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Products ──

  async listProducts(vendorType: string, vendorId: string) {
    const result = await query(
      `SELECT * FROM public.vendor_products
       WHERE vendor_type = $1 AND vendor_id = $2
       ORDER BY name`,
      [vendorType, vendorId],
    );
    return result.rows;
  },

  async createProduct(vendorType: string, vendorId: string, data: Record<string, unknown>) {
    try {
      return await queryOne(
        `INSERT INTO public.vendor_products (vendor_type, vendor_id, name, description, category, price, stock, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [vendorType, vendorId, data.name, data.description || null, data.category || null, data.price, data.stock ?? 0, data.is_active ?? true],
      );
    } catch (e) { mapPgError(e); }
  },

  async getProductById(productId: string, vendorType: string, vendorId: string) {
    return queryOne(
      `SELECT * FROM public.vendor_products WHERE id = $1 AND vendor_type = $2 AND vendor_id = $3`,
      [productId, vendorType, vendorId],
    );
  },

  async updateProduct(productId: string, vendorType: string, vendorId: string, fields: Record<string, unknown>) {
    // Matches updateProductSchema: name, description, category, price, stock, is_active.
    const ALLOWED_FIELDS = ['name', 'description', 'category', 'price', 'stock', 'is_active'] as const;
    // Three WHERE params, see updateService note above.
    const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS, { paramOffset: 3 });
    try {
      return await queryOne(
        `UPDATE public.vendor_products
         SET ${setClause}, updated_at = NOW()
         WHERE id = $1 AND vendor_type = $2 AND vendor_id = $3
         RETURNING *`,
        [productId, vendorType, vendorId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  async deleteProduct(productId: string, vendorType: string, vendorId: string) {
    // Hard delete or soft delete? The schema has is_active, let's hard delete or soft delete.
    // The previous implementation for services used soft delete. We'll use hard delete for products for simplicity, or soft delete. Let's stick to soft delete.
    try {
      return await queryOne(
        `DELETE FROM public.vendor_products WHERE id = $1 AND vendor_type = $2 AND vendor_id = $3 RETURNING *`,
        [productId, vendorType, vendorId],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Categories ────────────────────────────────────────────────────────────
  // Visible to a vendor = (global rows ∪ this vendor's own customs). Sorted by
  // sort_order first (admin curation) then name, so the picker presents a
  // stable, intentional list.
  //
  // `audience` filter (optional) narrows the visible roots:
  //   • 'grooming' → only grooming-audience rows (plus 'both')
  //   • 'wedding'  → only wedding-audience rows  (plus 'both')
  //   • 'both'     → only rows explicitly tagged 'both' (the cross-vertical set)
  //   • omitted    → no audience filter (legacy behaviour for existing callers)
  // Subcategories inherit visibility from their parent root: if a root is
  // included by the audience filter, all of its subs come along regardless of
  // the sub's own `audience` column (which is normally inherited at seed
  // time but can drift on vendor customs).
  async listCategoriesForVendor(
    vendorType: string,
    vendorId: string,
    opts?: { audience?: string },
  ) {
    const audienceFilter = opts?.audience
      ? // Root rows match the audience filter; subs join through their parent.
        `AND (
          sc.parent_id IS NULL
            AND (sc.audience IS NULL OR sc.audience IN ($3, 'both'))
          OR EXISTS (
            SELECT 1 FROM public.service_categories p
             WHERE p.id = sc.parent_id
               AND (p.audience IS NULL OR p.audience IN ($3, 'both'))
          )
        )`
      : '';
    const params: unknown[] = [vendorType, vendorId];
    if (opts?.audience) params.push(opts.audience);

    const result = await query<{
      id: string;
      parent_id: string | null;
      name: string;
      slug: string | null;
      description: string | null;
      icon: string | null;
      icon_url: string | null;
      sort_order: number;
      is_active: boolean;
      audience: string | null;
      vendor_type: string | null;
      vendor_id: string | null;
    }>(
      `SELECT sc.id, sc.parent_id, sc.name, sc.slug, sc.description, sc.icon,
              sc.icon_url, sc.sort_order, sc.is_active, sc.audience,
              sc.vendor_type, sc.vendor_id
         FROM public.service_categories sc
        WHERE sc.is_active = TRUE
          AND (sc.vendor_id IS NULL
               OR (sc.vendor_type = $1 AND sc.vendor_id = $2))
          ${audienceFilter}
        ORDER BY sc.sort_order, LOWER(sc.name)`,
      params,
    );
    return result.rows;
  },

  async getCategoryById(id: string) {
    return queryOne<{
      id: string;
      parent_id: string | null;
      name: string;
      slug: string | null;
      audience: string | null;
      vendor_type: string | null;
      vendor_id: string | null;
      is_active: boolean;
    }>(
      `SELECT id, parent_id, name, slug, audience, vendor_type, vendor_id, is_active
         FROM public.service_categories
        WHERE id = $1`,
      [id],
    );
  },

  async createVendorCategory(
    vendorType: string,
    vendorId: string,
    data: { name: string; parent_id?: string | null; audience?: string | null; slug?: string | null },
  ) {
    try {
      return await queryOne<{
        id: string;
        parent_id: string | null;
        name: string;
        slug: string | null;
        description: string | null;
        icon: string | null;
        icon_url: string | null;
        sort_order: number;
        is_active: boolean;
        audience: string | null;
        vendor_type: string;
        vendor_id: string;
      }>(
        // Slug auto-derives from name at INSERT time when the caller didn't
        // pass one — same rule as migration 073's backfill so the lookup
        // strategies stay consistent. audience defaults to the column default
        // ('grooming') when omitted; pass NULL explicitly to inherit.
        `INSERT INTO public.service_categories
           (parent_id, name, slug, sort_order, is_active, audience, vendor_type, vendor_id)
         VALUES (
           $1,
           $2,
           COALESCE(
             $3,
             TRIM(BOTH '-' FROM LOWER(
               REGEXP_REPLACE(REGEXP_REPLACE($2, '''', '', 'g'), '[^a-zA-Z0-9]+', '-', 'g')
             ))
           ),
           100,
           TRUE,
           COALESCE($4, 'grooming'),
           $5,
           $6
         )
         RETURNING id, parent_id, name, slug, description, icon, icon_url,
                   sort_order, is_active, audience, vendor_type, vendor_id`,
        [
          data.parent_id ?? null,
          data.name,
          data.slug ?? null,
          data.audience ?? null,
          vendorType,
          vendorId,
        ],
      );
    } catch (e) {
      mapPgError(e);
    }
  },

  async getPublicServiceById(id: string) {
    const sql = `
      SELECT s.id,
             s.name,
             s.description,
             s.price,
             s.duration_minutes,
             s.gender_target,
             s.service_location,
             s.category_id,
             sc.slug                                              AS category_slug,
             sc.name                                              AS category_name,
             mv.id                                                AS vendor_id,
             mv.url_slug                                          AS vendor_slug,
             mv.business_name                                     AS vendor_name,
             mv.vendor_type                                       AS vendor_type,
             mv.avg_rating                                        AS vendor_rating_avg,
             mv.review_count                                      AS vendor_rating_count,
             COALESCE(rs.rating_avg, 0)::numeric(3,2)             AS service_rating_avg,
             COALESCE(rs.rating_count, 0)                         AS service_rating_count,
             COALESCE(sp.photos, '[]'::json)                      AS photos
        FROM public.services s
        JOIN public.mv_vendor_discovery mv
          ON mv.id = s.vendor_id AND mv.vendor_type = s.vendor_type
        LEFT JOIN public.service_categories sc ON sc.id = s.category_id
        LEFT JOIN LATERAL (
          SELECT AVG(rating)::numeric(3,2) AS rating_avg, COUNT(*)::int AS rating_count
            FROM public.reviews
           WHERE target_kind = 'service_line' AND target_id = s.id AND is_visible = TRUE
        ) rs ON TRUE
        LEFT JOIN LATERAL (
          SELECT json_agg(mi.file_url ORDER BY mi.sort_order) AS photos
            FROM public.media_items mi
           WHERE mi.service_id = s.id AND mi.is_public = TRUE
        ) sp ON TRUE
       WHERE s.id = $1 AND s.is_active = TRUE
       LIMIT 1`;
    return queryOne<{
      id: string; name: string; description: string | null; price: string;
      duration_minutes: number; gender_target: string; service_location: string;
      category_id: string | null; category_slug: string | null; category_name: string | null;
      vendor_id: string; vendor_slug: string | null; vendor_name: string; vendor_type: string;
      vendor_rating_avg: string; vendor_rating_count: number;
      service_rating_avg: string; service_rating_count: number;
      photos: string[];
    }>(sql, [id]);
  },

  async getPublicProductById(id: string) {
    const sql = `
      SELECT p.id,
             p.name,
             p.description,
             p.price,
             p.category                                           AS category,
             mv.id                                                AS vendor_id,
             mv.url_slug                                          AS vendor_slug,
             mv.business_name                                     AS vendor_name,
             mv.vendor_type                                       AS vendor_type,
             mv.avg_rating                                        AS vendor_rating_avg,
             mv.review_count                                      AS vendor_rating_count,
             COALESCE(rp.rating_avg, 0)::numeric(3,2)             AS product_rating_avg,
             COALESCE(rp.rating_count, 0)                         AS product_rating_count
        FROM public.vendor_products p
        JOIN public.mv_vendor_discovery mv
          ON mv.id = p.vendor_id AND mv.vendor_type = p.vendor_type
        LEFT JOIN LATERAL (
          SELECT AVG(rating)::numeric(3,2) AS rating_avg, COUNT(*)::int AS rating_count
            FROM public.reviews
           WHERE target_kind = 'product' AND target_id = p.id AND is_visible = TRUE
        ) rp ON TRUE
       WHERE p.id = $1 AND p.is_active = TRUE
       LIMIT 1`;
    return queryOne<{
      id: string; name: string; description: string | null; price: string;
      category: string | null;
      vendor_id: string; vendor_slug: string | null; vendor_name: string; vendor_type: string;
      vendor_rating_avg: string; vendor_rating_count: number;
      product_rating_avg: string; product_rating_count: number;
    }>(sql, [id]);
  },
};

