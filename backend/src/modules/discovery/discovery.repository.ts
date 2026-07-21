// ─────────────────────────────────────────────────────────────────────────────
// Discovery Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';

export const discoveryRepository = {
  async searchVendors(params: {
    q?: string; vendorType?: string;
    lat?: number; lng?: number; radiusKm: number;
    category?: string; serviceId?: string;
    gender?: string; minRating?: number;
    minPrice?: number; maxPrice?: number;
    availableToday?: boolean;
    sortBy: string; limit: number;
  }) {
    const conditions: string[] = ['v.is_verified = TRUE'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (params.vendorType) {
      conditions.push(`v.vendor_type = $${paramIdx++}`);
      values.push(params.vendorType);
    }
    if (params.q) {
      conditions.push(`(v.business_name ILIKE $${paramIdx} OR v.display_name ILIKE $${paramIdx})`);
      values.push(`%${params.q}%`);
      paramIdx++;
    }
    if (params.gender) {
      conditions.push(`v.gender_preference = $${paramIdx++}`);
      values.push(params.gender);
    }
    if (params.minRating) {
      conditions.push(`v.avg_rating >= $${paramIdx++}`);
      values.push(params.minRating);
    }
    if (params.category) {
      // The portal /services/[slug] passes a category UUID, while many
      // services link to categories only via the legacy plain-text
      // `services.category` column (category_id is null). To match both
      // patterns, first resolve the param to a real service_categories
      // row (by id OR name) and then match each service against the
      // resolved row's id and name. Also OR against v.category for the
      // legacy primary-category-on-vendor match.
      conditions.push(`(
        v.category = $${paramIdx}
        OR EXISTS (
          SELECT 1
            FROM public.services s
            LEFT JOIN public.service_categories scs ON scs.id = s.category_id
            JOIN public.service_categories ref
              ON (ref.id::text = $${paramIdx} OR ref.name = $${paramIdx})
             AND ref.vendor_id IS NULL
           WHERE s.vendor_type = v.vendor_type
             AND s.vendor_id   = v.id
             AND s.is_active   = TRUE
             AND (
               s.category_id = ref.id
               OR scs.name   = ref.name
               OR s.category = ref.name
             )
        )
      )`);
      values.push(params.category);
      paramIdx++;
    }
    if (params.serviceId) {
      // Restrict to vendors that own this service, active.
      conditions.push(`EXISTS (
        SELECT 1 FROM public.services s
         WHERE s.vendor_type = v.vendor_type
           AND s.vendor_id   = v.id
           AND s.id          = $${paramIdx}
           AND s.is_active   = TRUE
      )`);
      values.push(params.serviceId);
      paramIdx++;
    }
    if (params.minPrice !== undefined) {
      conditions.push(`v.starting_price >= $${paramIdx++}`);
      values.push(params.minPrice);
    }
    if (params.maxPrice !== undefined) {
      conditions.push(`v.starting_price <= $${paramIdx++}`);
      values.push(params.maxPrice);
    }
    if (params.availableToday) {
      // Vendor has working hours for today's weekday and is not marked closed.
      // working_hours uses is_closed (BOOLEAN) — TRUE means closed, FALSE means open.
      conditions.push(`EXISTS (
        SELECT 1 FROM public.working_hours wh
         WHERE wh.target_type = v.vendor_type
           AND wh.target_id   = v.id
           AND wh.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::int
           AND wh.is_closed   = FALSE
      )`);
    }

    let distanceSelect = '';
    let orderBy = 'v.avg_rating DESC';

    if (params.lat !== undefined && params.lng !== undefined) {
      distanceSelect = `, ST_DistanceSphere(v.coordinates, ST_MakePoint($${paramIdx}, $${paramIdx + 1})) / 1000.0 AS distance_km`;
      conditions.push(`ST_DWithin(v.coordinates::geography, ST_MakePoint($${paramIdx}, $${paramIdx + 1})::geography, $${paramIdx + 2})`);
      values.push(params.lng, params.lat, params.radiusKm * 1000);
      paramIdx += 3;
      if (params.sortBy === 'distance') orderBy = 'distance_km ASC';
    }

    if (params.sortBy === 'rating') orderBy = 'v.avg_rating DESC';
    if (params.sortBy === 'price') orderBy = 'v.starting_price ASC';

    const result = await query(
      `SELECT v.id, v.vendor_type, v.business_name, v.display_name, v.logo_url,
              v.avg_rating, v.review_count, v.gender_preference, v.city, v.starting_price,
              COALESCE(fp.url_slug, sl.url_slug) AS url_slug,
              -- Cover image lives on the underlying vendor row, not the MV.
              -- Freelancers: fp.cover_image_url (added in migration 057).
              -- Salons: sl.cover_url (added in migration 003).
              COALESCE(fp.cover_image_url, sl.cover_url) AS cover_image_url,
              v.category AS primary_category
              ${distanceSelect}
       FROM public.mv_vendor_discovery v
       LEFT JOIN public.freelancer_profiles fp
              ON v.vendor_type = 'freelancer' AND fp.id = v.id
       LEFT JOIN public.salon_locations sl
              ON v.vendor_type = 'salon_location' AND sl.id = v.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx}`,
      [...values, params.limit + 1],
    );
    return result.rows;
  },

  async searchVendorsV2(args: {
    q?: string; vendorType?: string;
    lat?: number; lng?: number; radiusKm: number; city?: string;
    category?: string; serviceId?: string;
    genderTarget?: 'male'|'female'|'unisex';
    serviceMode?: 'home'|'onsite'|'both';                                 // API surface — same value set as DB service_location
    openNow?: boolean;
    minRating?: number; minPrice?: number; maxPrice?: number;
    sortBy: 'relevance'|'distance'|'rating_desc'|'price_asc'|'price_desc'|'popularity';
    limit: number; cursor: { score: number; id: string } | null;
  }) {
    const where: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (args.vendorType) { where.push(`v.vendor_type = $${i++}`); vals.push(args.vendorType); }
    if (args.q)          { where.push(`v.business_name ILIKE $${i++}`); vals.push(`%${args.q}%`); }
    if (args.city)       { where.push(`lower(v.city) = lower($${i++})`); vals.push(args.city); }
    if (args.minRating)  { where.push(`v.avg_rating >= $${i++}`); vals.push(args.minRating); }
    if (args.minPrice)   { where.push(`v.price_min >= $${i++}`); vals.push(args.minPrice); }
    if (args.maxPrice)   { where.push(`v.price_max <= $${i++}`); vals.push(args.maxPrice); }
    if (args.openNow)    { where.push(`v.is_open_now = TRUE`); }

    if (args.genderTarget) {
      const mask = args.genderTarget === 'male' ? 1 : args.genderTarget === 'female' ? 2 : 4;
      where.push(`(v.gender_target_mask & $${i++}) > 0`); vals.push(mask);
    }
    if (args.serviceMode) {
      const mask = args.serviceMode === 'home' ? 1 : args.serviceMode === 'onsite' ? 2 : 3;
      where.push(`(v.service_modes_mask & $${i++}) > 0`); vals.push(mask);
    }

    let distanceExpr = `0::numeric`;
    let distanceSelect = `0::numeric AS distance_km`;
    if (args.lat !== undefined && args.lng !== undefined) {
      const pLng = i++; const pLat = i++; const pRad = i++;
      vals.push(args.lng, args.lat, args.radiusKm);
      where.push(`ST_DWithin(v.coordinates, ST_MakePoint($${pLng}, $${pLat})::geography, $${pRad} * 1000)`);
      distanceExpr   = `ST_Distance(v.coordinates, ST_MakePoint($${pLng}, $${pLat})::geography) / 1000`;
      distanceSelect = `${distanceExpr} AS distance_km`;
    }

    const orderBy =
      args.sortBy === 'distance'     ? `${distanceExpr} ASC, v.id ASC` :
      args.sortBy === 'rating_desc'  ? `v.avg_rating DESC NULLS LAST, v.id DESC` :
      args.sortBy === 'price_asc'    ? `v.price_min ASC NULLS LAST, v.id ASC` :
      args.sortBy === 'price_desc'   ? `v.price_max DESC NULLS LAST, v.id DESC` :
      args.sortBy === 'popularity'   ? `v.review_count DESC, v.id DESC` :
                                       /* relevance */ `v.avg_rating DESC NULLS LAST, v.id DESC`;

    const cursorClause = args.cursor
      ? args.sortBy === 'distance'
        ? `AND ((${distanceExpr}), v.id) > ($${i++}, $${i++})`
        : args.sortBy === 'rating_desc' || args.sortBy === 'relevance'
          ? `AND (v.avg_rating, v.id) < ($${i++}, $${i++})`
          : args.sortBy === 'price_asc'
            ? `AND (v.price_min, v.id) > ($${i++}, $${i++})`
            : args.sortBy === 'price_desc'
              ? `AND (v.price_max, v.id) < ($${i++}, $${i++})`
              : `AND (v.review_count, v.id) < ($${i++}, $${i++})`
      : '';
    if (args.cursor) vals.push(args.cursor.score, args.cursor.id);

    const sql = `
      SELECT v.id, v.url_slug AS slug, v.business_name AS name, v.vendor_type AS type,
             v.avg_rating AS rating_avg, v.review_count AS rating_count,
             v.cover_image_url, v.logo_url,
             ST_X((v.coordinates)::geometry) AS lng,
             ST_Y((v.coordinates)::geometry) AS lat,
             v.city, v.category_slug,
             v.price_min, v.price_max, v.photo_count, v.is_verified AS verified, v.is_open_now,
             ${distanceSelect}
        FROM public.mv_vendor_discovery v
       WHERE ${where.length ? where.join(' AND ') : 'TRUE'}
             ${cursorClause}
       ORDER BY ${orderBy}
       LIMIT $${i}`;
    vals.push(args.limit + 1);

    const r = await query<any>(sql, vals);
    return r.rows;
  },

  async getCategories(opts?: { audience?: string }) {
    // Active global taxonomy, filtered by audience. For each row, count the
    // distinct (vendor_type, vendor_id) pairs that offer a service in it —
    // by either category_id FK or the legacy plain-text `services.category`
    // column matching the category name. The count powers the portal's
    // "N vendors" chip.
    //
    // Audience widening: a caller asking for 'grooming' also wants rows
    // tagged 'both' (those serve both audiences). Same for 'wedding'.
    // A caller asking specifically for 'both' gets only the cross-vertical
    // set. Omitted defaults to the historical grooming behaviour.
    const audience = opts?.audience ?? 'grooming';
    const audienceList = audience === 'both' ? ['both'] : [audience, 'both'];

    const result = await query(
      `SELECT
         c.id,
         c.name,
         c.slug,
         c.parent_id,
         c.icon_url,
         c.icon,
         c.description,
         c.audience,
         c.sort_order,
         (
           SELECT COUNT(DISTINCT (s.vendor_type, s.vendor_id))
             FROM public.services s
             JOIN public.mv_vendor_discovery v
               ON v.vendor_type = s.vendor_type AND v.id = s.vendor_id
            WHERE s.is_active   = TRUE
              AND v.is_verified = TRUE
              AND (s.category_id = c.id OR s.category = c.name)
         )::int AS vendor_count
         FROM public.service_categories c
        WHERE c.vendor_id IS NULL
          AND c.is_active = TRUE
          AND (
            -- Root rows: filter by their own audience (NULL = legacy = grooming)
            (c.parent_id IS NULL AND COALESCE(c.audience, 'grooming') = ANY($1::text[]))
            -- Sub rows: include whenever their parent is included
            OR EXISTS (
              SELECT 1 FROM public.service_categories p
               WHERE p.id = c.parent_id
                 AND p.vendor_id IS NULL
                 AND p.is_active = TRUE
                 AND COALESCE(p.audience, 'grooming') = ANY($1::text[])
            )
          )
        ORDER BY c.sort_order, c.name`,
      [audienceList],
    );
    return result.rows;
  },

  /** Look up a single root category by slug (vendor_id IS NULL). Returns
   *  null when no active root matches. Used for /discover/categories/:slug
   *  to power portal subcategory landing pages without a client-side scan. */
  async getCategoryRootBySlug(slug: string) {
    return queryOne<{
      id: string;
      name: string;
      slug: string;
      icon: string | null;
      icon_url: string | null;
      description: string | null;
      audience: string;
    }>(
      `SELECT id, name, slug, icon, icon_url, description, audience
         FROM public.service_categories
        WHERE parent_id IS NULL
          AND vendor_id IS NULL
          AND is_active = TRUE
          AND slug      = $1`,
      [slug],
    );
  },

  async getVendorDetail(vendorType: string, vendorId: string) {
    if (vendorType === 'freelancer') {
      // LEFT JOIN to users so vendors with orphan/null user_id still render
      // (email is optional metadata). An INNER JOIN here silently 404s
      // otherwise-valid verified vendors when their seed data is incomplete.
      return queryOne(
        `SELECT fp.*, u.email
           FROM public.freelancer_profiles fp
           LEFT JOIN public.users u ON fp.user_id = u.id
          WHERE fp.id = $1 AND fp.is_verified = TRUE`,
        [vendorId],
      );
    }
    return queryOne(
      `SELECT sl.*,
              ba.legal_business_name,
              ba.brand_name,
              ba.tagline           AS business_tagline,
              ba.description       AS business_description,
              ba.years_in_business AS years_in_business,
              ba.logo_url          AS business_logo_url,
              ba.cover_image_url   AS business_cover_image_url,
              ba.specializations   AS business_specializations,
              ba.languages         AS business_languages,
              ba.certifications    AS business_certifications,
              ba.website_url       AS business_website_url,
              ba.instagram_url     AS business_instagram_url,
              ba.youtube_url       AS business_youtube_url
         FROM public.salon_locations sl
         LEFT JOIN public.business_accounts ba ON sl.business_account_id = ba.id
        WHERE sl.id = $1 AND sl.is_active = TRUE`,
      [vendorId],
    );
  },

  async getVendorServices(vendorType: string, vendorId: string) {
    const result = await query(
      `SELECT * FROM public.services WHERE vendor_type = $1 AND vendor_id = $2 AND is_active = TRUE ORDER BY category, name`,
      [vendorType, vendorId],
    );
    return result.rows;
  },

  async getVendorReviews(vendorType: string, vendorId: string, sort: string, limit: number) {
    let orderBy = 'r.created_at DESC';
    if (sort === 'highest') orderBy = 'r.rating DESC, r.created_at DESC';
    if (sort === 'lowest') orderBy = 'r.rating ASC, r.created_at DESC';

    const result = await query(
      `SELECT r.*, cp.first_name AS reviewer_name
       FROM public.reviews r
       LEFT JOIN public.customer_profiles cp ON r.customer_id = cp.user_id
       WHERE r.vendor_type = $1 AND r.vendor_id = $2
       ORDER BY ${orderBy}
       LIMIT $3`,
      [vendorType, vendorId, limit + 1],
    );
    return result.rows;
  },

  async getVendorGallery(vendorType: string, vendorId: string) {
    const result = await query(
      `SELECT * FROM public.media_items WHERE vendor_type = $1 AND vendor_id = $2 AND is_public = TRUE ORDER BY sort_order, created_at DESC`,
      [vendorType, vendorId],
    );
    return result.rows;
  },

  async getVendorWorkingHours(vendorType: string, vendorId: string) {
    const result = await query(
      `SELECT * FROM public.working_hours WHERE target_type = $1 AND target_id = $2 ORDER BY day_of_week`,
      [vendorType, vendorId],
    );
    return result.rows;
  },

  // Increment the view counter for a vendor profile. Returns true if the row
  // existed and was updated. Customer-facing apps call this fire-and-forget;
  // we don't dedup server-side in v1 — clients are expected to throttle.
  async incrementVendorViewCount(vendorType: 'freelancer' | 'salon_location', vendorId: string): Promise<boolean> {
    const table = vendorType === 'freelancer' ? 'freelancer_profiles' : 'salon_locations';
    try {
      const result = await query(
        `UPDATE public.${table}
           SET view_count = view_count + 1
         WHERE id = $1 AND is_active = TRUE
         RETURNING id`,
        [vendorId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (e) { mapPgError(e); }
  },

  async getVendorStaff(vendorId: string) {
    const result = await query(
      `SELECT sm.id, u.email, sm.role, sm.is_active,
              COALESCE(AVG(r.rating), 0) AS avg_rating
       FROM public.staff_members sm
       JOIN public.users u ON sm.user_id = u.id
       LEFT JOIN public.appointments a ON a.staff_member_id = sm.id
       LEFT JOIN public.reviews r ON r.appointment_id = a.id
       WHERE sm.employer_id = $1 AND sm.is_active = TRUE
       GROUP BY sm.id, u.email, sm.role, sm.is_active`,
      [vendorId],
    );
    return result.rows;
  },

  async getFeaturedVendors(params: {
    vendorType?: 'freelancer' | 'salon_location'; limit: number;
  }) {
    // Primary signal: vendors that own at least one featured + active service
    // attached to a grooming-audience category. Fallback (lower bucket): top
    // rated verified active vendors.
    const result = await query<{
      id: string; vendor_type: string; business_name: string; display_name: string;
      logo_url: string | null; avg_rating: number; review_count: number;
      city: string | null; starting_price: number | null;
      url_slug: string | null;
    }>(
      `WITH featured_via_service AS (
         SELECT DISTINCT s.vendor_type, s.vendor_id
           FROM public.services s
           JOIN public.service_categories sc ON sc.id = s.category_id
          WHERE s.is_featured = TRUE
            AND s.is_active   = TRUE
            AND (sc.audience IS NULL OR sc.audience IN ('grooming','both'))
       ),
       ranked AS (
         SELECT v.id, v.vendor_type, v.business_name, v.display_name, v.logo_url,
                v.avg_rating, v.review_count, v.city, v.starting_price,
                COALESCE(fp.url_slug, sl.url_slug) AS url_slug,
                CASE WHEN EXISTS (
                  SELECT 1 FROM featured_via_service fs
                   WHERE fs.vendor_type = v.vendor_type AND fs.vendor_id = v.id
                ) THEN 1 ELSE 2 END AS bucket
           FROM public.mv_vendor_discovery v
           LEFT JOIN public.freelancer_profiles fp
                  ON v.vendor_type = 'freelancer' AND fp.id = v.id
           LEFT JOIN public.salon_locations sl
                  ON v.vendor_type = 'salon_location' AND sl.id = v.id
          WHERE v.is_verified = TRUE
            AND ($2::text IS NULL OR v.vendor_type = $2::text)
       )
       SELECT id, vendor_type, business_name, display_name, logo_url,
              avg_rating, review_count, city, starting_price, url_slug
         FROM ranked
        ORDER BY bucket ASC, avg_rating DESC NULLS LAST, review_count DESC
        LIMIT $1`,
      [params.limit, params.vendorType ?? null],
    );
    return result.rows;
  },

  async getTrendingVendors(params: {
    vendorType?: 'freelancer' | 'salon_location'; limit: number;
  }) {
    const result = await query<{
      id: string; vendor_type: string; business_name: string; display_name: string;
      logo_url: string | null; avg_rating: number; review_count: number;
      city: string | null; starting_price: number | null;
      url_slug: string | null;
    }>(
      `WITH trending_via_service AS (
         SELECT DISTINCT s.vendor_type, s.vendor_id
           FROM public.services s
           JOIN public.service_categories sc ON sc.id = s.category_id
          WHERE s.is_trending = TRUE
            AND s.is_active   = TRUE
            AND (sc.audience IS NULL OR sc.audience IN ('grooming','both'))
       ),
       recent_bookings AS (
         SELECT vendor_type, vendor_id, COUNT(*) AS booking_count
           FROM public.appointments
          WHERE created_at >= NOW() - INTERVAL '30 days'
            AND status IN ('confirmed','completed')
          GROUP BY vendor_type, vendor_id
       )
       SELECT v.id, v.vendor_type, v.business_name, v.display_name, v.logo_url,
              v.avg_rating, v.review_count, v.city, v.starting_price,
              COALESCE(fp.url_slug, sl.url_slug) AS url_slug
         FROM public.mv_vendor_discovery v
         LEFT JOIN recent_bookings rb
                ON rb.vendor_type = v.vendor_type AND rb.vendor_id = v.id
         LEFT JOIN public.freelancer_profiles fp
                ON v.vendor_type = 'freelancer' AND fp.id = v.id
         LEFT JOIN public.salon_locations sl
                ON v.vendor_type = 'salon_location' AND sl.id = v.id
        WHERE v.is_verified = TRUE
          AND ($2::text IS NULL OR v.vendor_type = $2::text)
        ORDER BY
          CASE WHEN EXISTS (
            SELECT 1 FROM trending_via_service ts
             WHERE ts.vendor_type = v.vendor_type AND ts.vendor_id = v.id
          ) THEN 1 ELSE 2 END ASC,
          COALESCE(rb.booking_count, 0) DESC,
          v.avg_rating DESC NULLS LAST
        LIMIT $1`,
      [params.limit, params.vendorType ?? null],
    );
    return result.rows;
  },

  async getVendorBySlug(slug: string, vendorType?: 'freelancer' | 'salon_location') {
    // Try requested vendor_type first; otherwise probe freelancer then salon.
    const probeFreelancer = async () => queryOne<{
      id: string; vendor_type: 'freelancer'; url_slug: string;
    }>(
      `SELECT id, 'freelancer'::text AS vendor_type, url_slug
         FROM public.freelancer_profiles
        WHERE url_slug = $1
        LIMIT 1`,
      [slug],
    );
    const probeSalon = async () => queryOne<{
      id: string; vendor_type: 'salon_location'; url_slug: string;
    }>(
      `SELECT id, 'salon_location'::text AS vendor_type, url_slug
         FROM public.salon_locations
        WHERE url_slug = $1
        LIMIT 1`,
      [slug],
    );

    if (vendorType === 'freelancer')      return probeFreelancer();
    if (vendorType === 'salon_location')  return probeSalon();
    return (await probeFreelancer()) ?? (await probeSalon());
  },

  async autocomplete(args: { q: string; city?: string; lat?: number; lng?: number }) {
    const cityFilterV = args.city ? `AND lower(v.city) = lower($2)` : '';
    const vendors = await query<any>(`
      SELECT v.id, v.url_slug AS slug, v.business_name AS name, v.city, v.vendor_type,
             similarity(v.business_name, $1) AS score
        FROM public.mv_vendor_discovery v
       WHERE v.business_name % $1 ${cityFilterV}
       ORDER BY score DESC, v.avg_rating DESC NULLS LAST
       LIMIT 5`,
      args.city ? [args.q, args.city] : [args.q],
    );

    const cityFilterS = args.city ? `AND lower(v.city) = lower($2)` : '';
    const services = await query<any>(`
      SELECT s.id, s.name,
             v.url_slug AS vendor_slug,
             v.business_name AS vendor_name,
             v.vendor_type AS vendor_type,
             similarity(s.name, $1) AS score
        FROM public.services s
        JOIN public.mv_vendor_discovery v
          ON v.id = s.vendor_id AND v.vendor_type = s.vendor_type
       WHERE s.is_active = TRUE
         AND s.name % $1
         ${cityFilterS}
       ORDER BY score DESC
       LIMIT 5`,
      args.city ? [args.q, args.city] : [args.q],
    );

    const categories = await query<any>(`
      SELECT id, slug, name FROM public.service_categories
       WHERE name % $1
         AND vendor_id IS NULL AND parent_id IS NULL
       ORDER BY similarity(name, $1) DESC
       LIMIT 5`,
      [args.q],
    );

    return { vendors: vendors.rows, services: services.rows, categories: categories.rows };
  },

  async nearYou({ lat, lng, limit }: { lat: number; lng: number; limit: number }) {
    const r = await query<any>(`
      SELECT id, url_slug AS slug, business_name AS name, vendor_type AS type,
             avg_rating AS rating_avg, review_count AS rating_count, city,
             ST_Distance(coordinates, ST_MakePoint($1, $2)::geography) / 1000 AS distance_km
        FROM public.mv_vendor_discovery
       ORDER BY coordinates <-> ST_MakePoint($1, $2)::geography
       LIMIT $3`, [lng, lat, limit]);
    return r.rows;
  },

  async cityLanding(slug: string) {
    const cityArg = slug.replace(/-/g, ' ');
    const [top, cats, trending] = await Promise.all([
      query<any>(`
        SELECT id, url_slug AS slug, business_name AS name, vendor_type AS type,
               avg_rating AS rating_avg, review_count AS rating_count
          FROM public.mv_vendor_discovery
         WHERE lower(city) = lower($1)
         ORDER BY avg_rating DESC NULLS LAST
         LIMIT 12`, [cityArg]),

      query<any>(`
        SELECT c.id, c.slug, c.name, COUNT(DISTINCT s.id)::int AS service_count
          FROM public.service_categories c
          JOIN public.services s ON s.category_id = c.id AND s.is_active = TRUE
          JOIN public.mv_vendor_discovery v
            ON v.id = s.vendor_id AND v.vendor_type = s.vendor_type
         WHERE lower(v.city) = lower($1)
           AND c.vendor_id IS NULL
         GROUP BY c.id, c.slug, c.name
         ORDER BY service_count DESC
         LIMIT 12`, [cityArg]),

      query<any>(`
        SELECT s.name,
               MIN(s.price)::numeric(10,2) AS price_from,
               COUNT(DISTINCT (s.vendor_type, s.vendor_id))::int AS vendor_count
          FROM public.services s
          JOIN public.mv_vendor_discovery v
            ON v.id = s.vendor_id AND v.vendor_type = s.vendor_type
         WHERE s.is_active = TRUE
           AND lower(v.city) = lower($1)
         GROUP BY s.name
         ORDER BY vendor_count DESC, MIN(s.price) ASC
         LIMIT 12`, [cityArg]),
    ]);
    return { topVendors: top.rows, topCategories: cats.rows, trendingServices: trending.rows };
  },

  async getVendorProfileBySlug(slug: string) {
    let vendor: any = await queryOne<any>(`
      SELECT 'freelancer'::text AS vendor_type,
             id, url_slug AS slug, business_name AS name,
             avg_rating AS rating_avg, review_count AS rating_count,
             is_verified, address_line1, city, state AS region,
             contact_phone AS phone, website_url,
             ST_X((coordinates)::geometry) AS lng, ST_Y((coordinates)::geometry) AS lat
        FROM public.freelancer_profiles
       WHERE url_slug = $1 AND is_active = TRUE
       LIMIT 1`, [slug]);
    if (!vendor) {
      vendor = await queryOne<any>(`
        SELECT 'salon_location'::text AS vendor_type,
               sl.id, sl.url_slug AS slug, sl.display_name AS name,
               sl.avg_rating AS rating_avg, sl.review_count AS rating_count,
               sl.is_verified, sl.address_line1, sl.city, sl.state AS region,
               sl.contact_phone AS phone, NULL::text AS website_url,
               ST_X((sl.coordinates)::geometry) AS lng,
               ST_Y((sl.coordinates)::geometry) AS lat
          FROM public.salon_locations sl
         WHERE sl.url_slug = $1 AND sl.is_active = TRUE
         LIMIT 1`, [slug]);
    }
    if (!vendor) return null;

    const [gallery, hours, services, products, similarIds, reviewAgg] = await Promise.all([
      query<any>(`
        SELECT file_url AS url, NULL::int AS w, NULL::int AS h, title AS alt
          FROM public.media_items
         WHERE vendor_type = $1 AND vendor_id = $2
           AND is_public = TRUE AND media_type = 'portfolio'
         ORDER BY sort_order
         LIMIT 30`, [vendor.vendor_type, vendor.id]),

      query<any>(`
        SELECT day_of_week AS dow, open_time AS open, close_time AS close, is_closed
          FROM public.working_hours
         WHERE target_type = $1 AND target_id = $2
         ORDER BY day_of_week`, [vendor.vendor_type, vendor.id]),

      query<any>(`
        SELECT s.id, s.name, s.price, s.duration_minutes, s.gender_target, s.service_location,
               s.category_id, c.slug AS category_slug, c.name AS category_name,
               COALESCE(r.rating_avg, 0)::numeric(3,2) AS rating_avg,
               COALESCE(r.rating_count, 0)            AS rating_count,
               COALESCE(sp.photos, '[]'::json)         AS photos
          FROM public.services s
          LEFT JOIN public.service_categories c ON c.id = s.category_id
          LEFT JOIN LATERAL (
            SELECT AVG(rating)::numeric(3,2) rating_avg, COUNT(*)::int rating_count
              FROM public.reviews
             WHERE target_kind = 'service_line' AND target_id = s.id AND is_visible = TRUE
          ) r ON TRUE
          LEFT JOIN LATERAL (
            SELECT json_agg(mi.file_url ORDER BY mi.sort_order) AS photos
              FROM public.media_items mi
             WHERE mi.service_id = s.id AND mi.is_public = TRUE
          ) sp ON TRUE
         WHERE s.vendor_type = $1 AND s.vendor_id = $2 AND s.is_active = TRUE
         ORDER BY c.name NULLS LAST, s.price ASC`, [vendor.vendor_type, vendor.id]),

      query<any>(`
        SELECT p.id, p.name, p.price, p.category,
               '[]'::json                              AS photos,
               COALESCE(r.rating_avg, 0)::numeric(3,2) AS rating_avg,
               COALESCE(r.rating_count, 0)             AS rating_count
          FROM public.vendor_products p
          LEFT JOIN LATERAL (
            SELECT AVG(rating)::numeric(3,2) rating_avg, COUNT(*)::int rating_count
              FROM public.reviews
             WHERE target_kind = 'product' AND target_id = p.id AND is_visible = TRUE
          ) r ON TRUE
         WHERE p.vendor_type = $1 AND p.vendor_id = $2 AND p.is_active = TRUE
         ORDER BY p.created_at DESC LIMIT 24`, [vendor.vendor_type, vendor.id]),

      query<any>(`
        SELECT id, vendor_type FROM public.mv_vendor_discovery
         WHERE lower(city) = lower($1) AND id <> $2
         ORDER BY avg_rating DESC NULLS LAST LIMIT 6`, [vendor.city ?? '', vendor.id]),

      queryOne<any>(`
        SELECT COALESCE(AVG(rating)::numeric(3,2), 0) rating_avg,
               COUNT(*)::int rating_count,
               COUNT(*) FILTER (WHERE rating = 5)::int r5,
               COUNT(*) FILTER (WHERE rating = 4)::int r4,
               COUNT(*) FILTER (WHERE rating = 3)::int r3,
               COUNT(*) FILTER (WHERE rating = 2)::int r2,
               COUNT(*) FILTER (WHERE rating = 1)::int r1,
               COUNT(*) FILTER (WHERE jsonb_array_length(photos) > 0)::int photo_count
          FROM public.reviews
         WHERE target_kind = 'vendor' AND target_id = $1 AND is_visible = TRUE`, [vendor.id]),
    ]);

    const faq: { rows: Array<{ q: string; a: string }> } = { rows: [] };

    return {
      vendor, gallery: gallery.rows, hours: hours.rows, services: services.rows,
      products: products.rows, faq: faq.rows,
      similarIds: similarIds.rows.map((r: any) => r.id),
      reviewAggregate: reviewAgg,
    };
  },
};
