// ─────────────────────────────────────────────────────────────────────────────
// Admin Vendors — Repository
// ─────────────────────────────────────────────────────────────────────────────
// Vendor union: freelancer_profiles + salon_locations exposed as one stream.
// Each row carries `vendor_type` (freelancer | salon_location) so the UI can
// decide which icon, link target, and detail tabs to render.
//
// Aggregate columns (`total_bookings`, `total_revenue_inr`) are computed via
// LEFT JOIN to a per-vendor aggregate CTE. For platforms with millions of
// appointments this should be moved to a refreshed materialised view; v1
// trades a small live-aggregate cost for simplicity.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type { VendorCreateBody, VendorListQuery, VendorUpdateBody } from './admin-vendors.schemas';

export interface VendorRow {
  id: string;
  vendor_type: 'freelancer' | 'salon_location';
  business_name: string;
  display_name: string | null;
  city: string | null;
  is_verified: boolean;
  is_active: boolean;
  contact_email: string | null;
  contact_phone: string | null;
  commission_percentage: number;
  total_bookings: number;
  total_revenue_inr: number;
  created_at: string;
}

export interface VendorDetail extends VendorRow {
  bio: string | null;
  address_line1: string | null;
  state: string | null;
  postal_code: string | null;
  country_code: string | null;
  category: string | null;
  gender_preference: string | null;
  avg_rating: number;
  review_count: number;
  starting_price: number | null;
  // For salons:
  business_account_id?: string | null;
  legal_business_name?: string | null;
  // For freelancers:
  user_id?: string | null;
}

const SORTABLE: Record<string, string> = {
  'created_at:desc': 'created_at DESC, id DESC',
  'created_at:asc':  'created_at ASC, id ASC',
  'name:asc':        'business_name ASC, id ASC',
  'name:desc':       'business_name DESC, id DESC',
};

export const adminVendorsRepository = {
  async list(q: VendorListQuery): Promise<{ rows: VendorRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (q.type !== 'all') {
      push("v.vendor_type = ?", q.type === 'salon' ? 'salon_location' : 'freelancer');
    }
    if (q.kyc_status === 'pending')  conditions.push('v.is_verified = FALSE');
    if (q.kyc_status === 'approved') conditions.push('v.is_verified = TRUE');
    if (q.is_active !== undefined)   push('v.is_active = ?', q.is_active);
    if (q.city) {
      params.push(`%${q.city.toLowerCase()}%`);
      conditions.push(`LOWER(v.city) LIKE $${params.length}`);
    }
    if (q.joined_from) push('v.created_at >= ?', q.joined_from);
    if (q.joined_to)   push('v.created_at <= ?', q.joined_to);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(v.business_name) LIKE ${p}
          OR LOWER(COALESCE(v.display_name,'')) LIKE ${p}
          OR LOWER(COALESCE(v.contact_email,'')) LIKE ${p}
          OR COALESCE(v.contact_phone,'') LIKE ${p})`,
      );
    }

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at && q.sort.startsWith('created_at')) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(
          `(v.created_at, v.id) < ($${params.length - 1}, $${params.length})`,
        );
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = SORTABLE[q.sort] ?? SORTABLE['created_at:desc'];
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<VendorRow>(
      `WITH unified AS (
         SELECT fp.id,
                'freelancer'::text AS vendor_type,
                fp.business_name,
                fp.display_name,
                fp.city,
                fp.is_verified,
                fp.is_active,
                u.email   AS contact_email,
                u.phone_number AS contact_phone,
                fp.commission_percentage,
                fp.created_at
         FROM public.freelancer_profiles fp
         JOIN public.users u ON u.id = fp.user_id
         UNION ALL
         SELECT sl.id,
                'salon_location'::text AS vendor_type,
                COALESCE(ba.brand_name, ba.legal_business_name) AS business_name,
                sl.display_name,
                sl.city,
                sl.is_verified,
                sl.is_active,
                sl.contact_email,
                sl.contact_phone,
                0::numeric AS commission_percentage,
                sl.created_at
         FROM public.salon_locations sl
         JOIN public.business_accounts ba ON ba.id = sl.business_account_id
       ),
       agg AS (
         SELECT a.vendor_type, a.vendor_id,
                COUNT(*)::int AS total_bookings,
                COALESCE(SUM(t.amount), 0)::numeric AS total_revenue_inr
         FROM public.appointments a
         LEFT JOIN public.transactions t
                ON t.appointment_id = a.id AND t.status = 'completed'
         GROUP BY a.vendor_type, a.vendor_id
       )
       SELECT v.*,
              COALESCE(agg.total_bookings, 0) AS total_bookings,
              COALESCE(agg.total_revenue_inr, 0) AS total_revenue_inr
       FROM unified v
       LEFT JOIN agg ON agg.vendor_type = v.vendor_type AND agg.vendor_id = v.id
       ${where}
       ORDER BY ${order}
       LIMIT ${limitParam}`,
      params,
    );

    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<VendorDetail | null> {
    const freelancer = await queryOne<VendorDetail>(
      `SELECT fp.id,
              'freelancer'::text AS vendor_type,
              fp.business_name,
              fp.display_name,
              fp.bio,
              fp.address_line1,
              fp.city,
              fp.state,
              fp.postal_code,
              fp.country_code,
              fp.category,
              fp.gender_preference,
              fp.is_verified,
              fp.is_active,
              fp.avg_rating::float8 AS avg_rating,
              fp.review_count,
              fp.starting_price::float8 AS starting_price,
              fp.commission_percentage::float8 AS commission_percentage,
              u.email   AS contact_email,
              u.phone_number AS contact_phone,
              fp.user_id,
              fp.created_at
       FROM public.freelancer_profiles fp
       JOIN public.users u ON u.id = fp.user_id
       WHERE fp.id = $1`,
      [id],
    );
    if (freelancer) {
      const agg = await queryOne<{ total_bookings: number; total_revenue_inr: number }>(
        `SELECT COUNT(*)::int AS total_bookings,
                COALESCE(SUM(t.amount), 0)::float8 AS total_revenue_inr
         FROM public.appointments a
         LEFT JOIN public.transactions t
                ON t.appointment_id = a.id AND t.status = 'completed'
         WHERE a.vendor_type = 'freelancer' AND a.vendor_id = $1`,
        [id],
      );
      return { ...freelancer, ...(agg ?? { total_bookings: 0, total_revenue_inr: 0 }) };
    }

    const salon = await queryOne<VendorDetail>(
      `SELECT sl.id,
              'salon_location'::text AS vendor_type,
              COALESCE(ba.brand_name, ba.legal_business_name) AS business_name,
              sl.display_name,
              NULL::text AS bio,
              sl.address_line1,
              sl.city,
              sl.state,
              sl.postal_code,
              sl.country_code,
              sl.category,
              sl.gender_preference,
              sl.is_verified,
              sl.is_active,
              sl.avg_rating::float8 AS avg_rating,
              sl.review_count,
              sl.starting_price::float8 AS starting_price,
              0::float8 AS commission_percentage,
              sl.contact_email,
              sl.contact_phone,
              ba.id AS business_account_id,
              ba.legal_business_name,
              sl.created_at
       FROM public.salon_locations sl
       JOIN public.business_accounts ba ON ba.id = sl.business_account_id
       WHERE sl.id = $1`,
      [id],
    );
    if (salon) {
      const agg = await queryOne<{ total_bookings: number; total_revenue_inr: number }>(
        `SELECT COUNT(*)::int AS total_bookings,
                COALESCE(SUM(t.amount), 0)::float8 AS total_revenue_inr
         FROM public.appointments a
         LEFT JOIN public.transactions t
                ON t.appointment_id = a.id AND t.status = 'completed'
         WHERE a.vendor_type = 'salon_location' AND a.vendor_id = $1`,
        [id],
      );
      return { ...salon, ...(agg ?? { total_bookings: 0, total_revenue_inr: 0 }) };
    }

    return null;
  },

  async update(id: string, vendorType: 'freelancer' | 'salon_location', patch: VendorUpdateBody): Promise<VendorDetail | null> {
    // Map admin-facing field names to the column they live on per vendor type.
    // A field that doesn't exist on the chosen table is silently dropped.
    const FREELANCER_COLS: Record<string, string> = {
      is_active: 'is_active', is_verified: 'is_verified',
      business_name: 'business_name', display_name: 'display_name',
      bio: 'bio', category: 'category', gender_preference: 'gender_preference',
      starting_price: 'starting_price',
      contact_phone: 'contact_phone',
      address_line1: 'address_line1', city: 'city', state: 'state',
      postal_code: 'postal_code', country_code: 'country_code',
      logo_url: 'logo_url',
      commission_percentage: 'commission_percentage',
      upi_id: 'upi_id', upi_display_name: 'upi_display_name',
    };
    const SALON_COLS: Record<string, string> = {
      is_active: 'is_active', is_verified: 'is_verified',
      display_name: 'display_name',
      category: 'category', gender_preference: 'gender_preference',
      starting_price: 'starting_price',
      contact_phone: 'contact_phone', contact_email: 'contact_email',
      address_line1: 'address_line1', address_line2: 'address_line2',
      city: 'city', state: 'state',
      postal_code: 'postal_code', country_code: 'country_code',
      logo_url: 'logo_url', cover_url: 'cover_url',
      url_slug: 'url_slug',
    };

    const colMap = vendorType === 'freelancer' ? FREELANCER_COLS : SALON_COLS;
    const table = vendorType === 'freelancer' ? 'public.freelancer_profiles' : 'public.salon_locations';

    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    for (const [key, col] of Object.entries(colMap)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    }

    // Salons keep their owner email/phone on the user row; freelancers do too.
    // Updating the contact_email is a separate concern — for v1 we keep it on
    // freelancers' user row (only field that diverges).
    try {
      if (vendorType === 'freelancer' && patch.contact_email !== undefined) {
        params.push(patch.contact_email);
        const userIdRow = await queryOne<{ user_id: string }>(
          `SELECT user_id FROM public.freelancer_profiles WHERE id = $1`,
          [id],
        );
        if (userIdRow) {
          await query(`UPDATE public.users SET email = $1, updated_at = NOW() WHERE id = $2`,
            [patch.contact_email, userIdRow.user_id]);
        }
        params.pop();
      }

      if (sets.length > 1) {
        params.push(id);
        await query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      }
    } catch (e) { mapPgError(e); }

    return this.getById(id);
  },

  async softDelete(id: string, vendorType: 'freelancer' | 'salon_location'): Promise<void> {
    const table = vendorType === 'freelancer' ? 'public.freelancer_profiles' : 'public.salon_locations';
    try {
      await query(`UPDATE ${table} SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
    } catch (e) { mapPgError(e); }
  },

  /**
   * Create a new vendor end-to-end:
   *   freelancer → users row (role=freelancer) + freelancer_profiles row
   *   salon      → users row (role=business_admin) + business_accounts + salon_locations row
   *
   * Returns the new vendor id (UUID) so the controller can re-fetch via getById.
   * The user row gets `is_active=true, is_email_verified=false`; the actual
   * password is set out-of-band (admin sends a reset link in v2).
   */
  async create(input: VendorCreateBody): Promise<{ id: string; vendor_type: 'freelancer' | 'salon_location' }> {
    try {
      if (input.vendor_type === 'freelancer') {
        const user = await queryOne<{ id: string }>(
          `INSERT INTO public.users (email, phone_number, role, is_active, is_email_verified)
           VALUES ($1, $2, 'freelancer', TRUE, FALSE)
           RETURNING id`,
          [input.email, input.phone_number ?? null],
        );
        if (!user) throw new Error('Failed to create user row for freelancer');

        const fp = await queryOne<{ id: string }>(
          `INSERT INTO public.freelancer_profiles
             (user_id, business_name, display_name, city, category, starting_price, commission_percentage, is_active, is_verified)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE)
           RETURNING id`,
          [
            user.id,
            input.business_name,
            input.display_name ?? input.business_name,
            input.city ?? null,
            input.category ?? null,
            input.starting_price ?? null,
            input.commission_percentage ?? 0,
          ],
        );
        if (!fp) throw new Error('Failed to create freelancer_profiles row');
        return { id: fp.id, vendor_type: 'freelancer' };
      }

      // Salon path
      const owner = await queryOne<{ id: string }>(
        `INSERT INTO public.users (email, phone_number, role, is_active, is_email_verified)
         VALUES ($1, $2, 'business_admin', TRUE, FALSE)
         RETURNING id`,
        [input.owner_email, input.owner_phone ?? null],
      );
      if (!owner) throw new Error('Failed to create user row for salon owner');

      const ba = await queryOne<{ id: string }>(
        `INSERT INTO public.business_accounts (owner_user_id, legal_business_name, brand_name, is_active)
         VALUES ($1, $2, $3, TRUE)
         RETURNING id`,
        [owner.id, input.legal_business_name, input.brand_name ?? null],
      );
      if (!ba) throw new Error('Failed to create business_accounts row');

      const sl = await queryOne<{ id: string }>(
        `INSERT INTO public.salon_locations
           (business_account_id, display_name, city, address_line1, state, postal_code, is_active, is_verified)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE)
         RETURNING id`,
        [
          ba.id,
          input.display_name,
          input.city ?? null,
          input.address_line1 ?? null,
          input.state ?? null,
          input.postal_code ?? null,
        ],
      );
      if (!sl) throw new Error('Failed to create salon_locations row');
      return { id: sl.id, vendor_type: 'salon_location' };
    } catch (e) { mapPgError(e); }
  },
};
