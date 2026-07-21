// ─────────────────────────────────────────────────────────────────────────────
// Business Module — Repository Layer
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne, withTransaction } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';
import { PoolClient } from 'pg';

export const businessRepository = {
  // ── BIZ-01: Get Business Profile ──
  // Joins the primary (oldest active) salon_location so the salon-dashboard's
  // /portfolio page can render address, lat/lng, and verification status without
  // a second round-trip. The primary-location concept matches the v1 single-
  // location B2B model; multi-location chains will keep working — the JOIN
  // simply picks the oldest active row.
  async getBusinessProfile(businessAccountId: string) {
    return queryOne(
      `WITH primary_loc AS (
         SELECT sl.id, sl.url_slug, sl.address_line1, sl.address_line2, sl.city, sl.state,
                sl.postal_code, sl.country_code, sl.is_verified,
                sl.avg_rating, sl.review_count, sl.amenities,
                ST_Y(sl.coordinates::geometry) AS latitude,
                ST_X(sl.coordinates::geometry) AS longitude
         FROM public.salon_locations sl
         WHERE sl.business_account_id = $1 AND sl.is_active = TRUE
         ORDER BY sl.created_at
         LIMIT 1
       )
       SELECT ba.*,
              pl.id              AS primary_location_id,
              pl.url_slug        AS url_slug,
              pl.address_line1,
              pl.address_line2,
              pl.city,
              pl.state,
              pl.postal_code,
              pl.country_code,
              pl.latitude,
              pl.longitude,
              COALESCE(pl.amenities, '{}'::TEXT[]) AS amenities,
              COALESCE(pl.is_verified, FALSE) AS kyc_verified,
              COALESCE(pl.avg_rating, 0)      AS avg_rating,
              COALESCE(pl.review_count, 0)    AS review_count,
              (SELECT COUNT(*) FROM public.salon_locations sl WHERE sl.business_account_id = ba.id AND sl.is_active = TRUE) AS location_count,
              (SELECT COUNT(*) FROM public.staff_members sm
               JOIN public.salon_locations sl2 ON sm.employer_id = sl2.id
               WHERE sl2.business_account_id = ba.id AND sm.is_active = TRUE) AS staff_count
       FROM public.business_accounts ba
       LEFT JOIN primary_loc pl ON TRUE
       WHERE ba.id = $1`,
      [businessAccountId],
    );
  },

  // Returns the primary (oldest active) location id for a business, or null.
  async getPrimaryLocationId(businessAccountId: string): Promise<string | null> {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM public.salon_locations
       WHERE business_account_id = $1 AND is_active = TRUE
       ORDER BY created_at LIMIT 1`,
      [businessAccountId],
    );
    return row?.id ?? null;
  },

  // Engagement counters for the salon dashboard's Manage Gallery tiles.
  // view_count: incremented by customer-facing apps via POST /discovery/.../view
  // favorite_count: rows in public.favorites pointing at this location
  // review_count + avg_rating: computed by trigger; mirrored on salon_locations
  async getEngagementMetrics(businessAccountId: string) {
    return queryOne<{
      view_count: number;
      favorite_count: number;
      review_count: number;
      avg_rating: number;
      primary_location_id: string | null;
    }>(
      `WITH primary_loc AS (
         SELECT id, view_count, review_count, avg_rating
         FROM public.salon_locations
         WHERE business_account_id = $1 AND is_active = TRUE
         ORDER BY created_at LIMIT 1
       )
       SELECT COALESCE(pl.id, NULL)               AS primary_location_id,
              COALESCE(pl.view_count, 0)::bigint  AS view_count,
              (SELECT COUNT(*)::bigint FROM public.favorites f
                 WHERE f.vendor_type = 'salon_location'
                   AND pl.id IS NOT NULL AND f.vendor_id = pl.id) AS favorite_count,
              COALESCE(pl.review_count, 0)::int   AS review_count,
              COALESCE(pl.avg_rating, 0)::float   AS avg_rating
         FROM primary_loc pl
         FULL OUTER JOIN (SELECT 1) one ON TRUE`,
      [businessAccountId],
    );
  },

  // ── BIZ-02: Update Business Profile ──
  // Columns a business_admin can update via updateBusinessProfileSchema
  // (address/location fields are split out by the service layer to updateLocation).
  // `certifications` is JSONB — pre-serialised to a JSON string before passing
  // to buildUpdateSet so the pg driver sends text (not a Postgres array literal).
  async updateBusinessProfile(businessAccountId: string, fields: Record<string, unknown>) {
    const ALLOWED_FIELDS = [
      'legal_business_name', 'brand_name', 'description', 'tagline',
      'specializations', 'languages', 'logo_url', 'cover_image_url',
      'website_url', 'instagram_url', 'youtube_url',
      'contact_email', 'contact_phone', 'gstin',
      'years_in_business', 'certifications',
      'upi_id', 'upi_display_name',
    ] as const;
    const normalized: Record<string, unknown> = { ...fields };
    if (Array.isArray(normalized.certifications)) {
      normalized.certifications = JSON.stringify(normalized.certifications);
    }
    const { setClause, values } = buildUpdateSet(normalized, ALLOWED_FIELDS);
    try {
      return await queryOne(
        `UPDATE public.business_accounts
         SET ${setClause}, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [businessAccountId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── BIZ-03: Get Location ──
  async getLocation(locationId: string, businessAccountId: string) {
    return queryOne(
      `SELECT sl.*, 
              ST_Y(sl.coordinates::geometry) AS latitude,
              ST_X(sl.coordinates::geometry) AS longitude
       FROM public.salon_locations sl
       WHERE sl.id = $1 AND sl.business_account_id = $2`,
      [locationId, businessAccountId],
    );
  },

  // ── BIZ-04: Update Location ──
  // lat/lng are extracted and converted to a PostGIS POINT — they are not
  // standalone DB columns.  All other scalar fields go through buildUpdateSet.
  // Note: the updateLocationSchema uses 'pincode' but the DB column is
  // 'postal_code'; 'pincode' is therefore intentionally absent from this
  // allowlist (it would be silently filtered, matching current behaviour).
  async updateLocation(locationId: string, businessAccountId: string, fields: Record<string, unknown>) {
    const ALLOWED_FIELDS = [
      'display_name', 'address_line1', 'address_line2', 'city', 'state',
      'postal_code', 'phone', 'is_active', 'amenities',
    ] as const;

    const { latitude, longitude, ...otherFields } = fields as Record<string, unknown> & {
      latitude?: number;
      longitude?: number;
    };

    // Start with an empty set/values pair; if no allowed scalar fields
    // are present, only the coordinate clause (if provided) will appear.
    const setClauses: string[] = [];
    const values: unknown[] = [];

    // Filter scalar fields through the allowlist.
    // The UPDATE has TWO WHERE params (id = $1, business_account_id = $2),
    // so SET placeholders must start at $3 — paramOffset: 2.
    try {
      const { setClause, values: sv } = buildUpdateSet(otherFields, ALLOWED_FIELDS, { paramOffset: 2 });
      setClauses.push(setClause);
      values.push(...sv);
    } catch {
      // ValidationError: no allowed scalar fields — coordinates may still be set
    }

    // Handle coordinates separately (PostGIS geometry, not a plain column).
    // values.length already counts the scalar SET values, so the next
    // placeholder index is values.length + 3 (locationId + businessAccountId + offset).
    if (latitude !== undefined && longitude !== undefined) {
      setClauses.push(`coordinates = ST_SetSRID(ST_MakePoint($${values.length + 3}, $${values.length + 4}), 4326)`);
      values.push(longitude, latitude);
    }

    if (setClauses.length === 0) return null;

    try {
      return await queryOne(
        `UPDATE public.salon_locations
         SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND business_account_id = $2
         RETURNING *`,
        [locationId, businessAccountId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── BIZ-05: List Staff ──
  async listStaff(businessAccountId: string) {
    const result = await query(
      `SELECT sm.*, u.email, u.phone_number, u.first_name, u.last_name
       FROM public.staff_members sm
       JOIN public.users u ON sm.user_id = u.id
       JOIN public.salon_locations sl ON sm.employer_id = sl.id
       WHERE sl.business_account_id = $1
       ORDER BY sm.created_at DESC`,
      [businessAccountId],
    );
    return result.rows;
  },

  // ── BIZ-06: Get Staff Member ──
  async getStaffMember(staffId: string, businessAccountId: string) {
    return queryOne(
      `SELECT sm.*, u.email, u.phone_number, u.first_name, u.last_name
       FROM public.staff_members sm
       JOIN public.users u ON sm.user_id = u.id
       JOIN public.salon_locations sl ON sm.employer_id = sl.id
       WHERE sm.id = $1 AND sl.business_account_id = $2`,
      [staffId, businessAccountId],
    );
  },

  // ── BIZ-07: Invite Staff ──
  async inviteStaff(params: {
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    locationId: string;
    commissionRate?: number;
    businessAccountId: string;
  }) {
    return withTransaction(async (client: PoolClient) => {
      try {
        // 1. Check if location belongs to this business
        const location = await client.query(
          `SELECT id FROM public.salon_locations WHERE id = $1 AND business_account_id = $2`,
          [params.locationId, params.businessAccountId],
        );
        if (location.rows.length === 0) {
          const { TenantMismatchError } = await import('../../lib/errors');
          throw new TenantMismatchError();
        }

        // 2. Create user account for staff
        const userResult = await client.query<{ id: string }>(
          `INSERT INTO public.users (email, password_hash, role, first_name, last_name)
           VALUES ($1, '', 'staff', $2, $3)
           ON CONFLICT (email) DO UPDATE SET role = 'staff', first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
           RETURNING id`,
          [params.email, params.firstName, params.lastName],
        );
        const userId = userResult.rows[0]!.id;

        // 3. Create staff_members record
        const staffResult = await client.query<{ id: string }>(
          `INSERT INTO public.staff_members (user_id, employer_id, role, commission_percentage)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [userId, params.locationId, params.role, params.commissionRate ?? 0],
        );

        return { userId, staffId: staffResult.rows[0]!.id };
      } catch (e) { mapPgError(e); }
    });
  },

  // ── BIZ-08: Update Staff ──
  // Matches updateStaffSchema: role, commission_percentage, is_active.
  // Excludes: id, user_id, employer_id (structural), created_at.
  async updateStaff(staffId: string, businessAccountId: string, fields: Record<string, unknown>) {
    const ALLOWED_FIELDS = ['role', 'commission_percentage', 'is_active'] as const;
    // Two WHERE params (sm.id = $1, sl.business_account_id = $2),
    // so SET placeholders start at $3 — paramOffset: 2.
    const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS, { paramOffset: 2 });
    try {
      return await queryOne(
        `UPDATE public.staff_members sm
         SET ${setClause}
         FROM public.salon_locations sl
         WHERE sm.id = $1
           AND sm.employer_id = sl.id
           AND sl.business_account_id = $2
         RETURNING sm.*`,
        [staffId, businessAccountId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── BIZ-09: Get Staff Schedule ──
  async getStaffSchedule(staffId: string, businessAccountId: string) {
    const result = await query(
      `SELECT ss.* FROM public.shift_schedules ss
       JOIN public.staff_members sm ON ss.staff_member_id = sm.id
       JOIN public.salon_locations sl ON sm.employer_id = sl.id
       WHERE sm.id = $1 AND sl.business_account_id = $2
       ORDER BY ss.shift_date, ss.start_time`,
      [staffId, businessAccountId],
    );
    return result.rows;
  },

  // ── BIZ-10: Get Staff Attendance ──
  async getStaffAttendance(staffId: string, businessAccountId: string) {
    const result = await query(
      `SELECT sa.* FROM public.staff_attendance sa
       JOIN public.staff_members sm ON sa.staff_member_id = sm.id
       JOIN public.salon_locations sl ON sm.employer_id = sl.id
       WHERE sm.id = $1 AND sl.business_account_id = $2
       ORDER BY sa.date DESC, sa.clock_in_at DESC
       LIMIT 30`,
      [staffId, businessAccountId],
    );
    return result.rows;
  },

  // ── BIZ-11: Get Staff Appointments ──
  async getStaffAppointments(staffId: string, businessAccountId: string) {
    const result = await query(
      `SELECT a.*, cu.phone_number AS customer_phone,
              COALESCE(cp.first_name || ' ' || cp.last_name, u2.email) AS customer_name,
              ARRAY_AGG(DISTINCT ali.service_name) FILTER (WHERE ali.service_name IS NOT NULL) AS service_names
       FROM public.appointments a
       JOIN public.staff_members sm ON a.staff_member_id = sm.id
       JOIN public.salon_locations sl ON sm.employer_id = sl.id
       LEFT JOIN public.users u2 ON a.customer_id = u2.id
       LEFT JOIN public.customer_profiles cp ON cp.user_id = a.customer_id
       LEFT JOIN public.users cu ON cu.id = a.customer_id
       LEFT JOIN public.appointment_line_items ali ON ali.appointment_id = a.id
       WHERE a.staff_member_id = sm.id AND sl.business_account_id = $2 AND sm.id = $1
       GROUP BY a.id, cu.phone_number, cp.first_name, cp.last_name, u2.email
       ORDER BY a.start_time DESC
       LIMIT 50`,
      [staffId, businessAccountId],
    );
    return result.rows;
  },

  // ── BIZ-12: Get Staff Salary Summary ──
  async getStaffSalary(staffId: string, businessAccountId: string) {
    return queryOne<{
      commission_percentage: number;
      completed_this_month: number;
      revenue_this_month: number;
      commission_this_month: number;
    }>(
      `SELECT sm.commission_percentage,
              COUNT(DISTINCT a.id) FILTER (
                WHERE a.status = 'completed'
                AND DATE_TRUNC('month', a.start_time) = DATE_TRUNC('month', NOW())
              ) AS completed_this_month,
              COALESCE(SUM(ali.locked_price) FILTER (
                WHERE a.status = 'completed'
                AND DATE_TRUNC('month', a.start_time) = DATE_TRUNC('month', NOW())
              ), 0) AS revenue_this_month,
              COALESCE(
                SUM(ali.locked_price) FILTER (
                  WHERE a.status = 'completed'
                  AND DATE_TRUNC('month', a.start_time) = DATE_TRUNC('month', NOW())
                ) * sm.commission_percentage / 100,
                0
              ) AS commission_this_month
       FROM public.staff_members sm
       JOIN public.salon_locations sl ON sm.employer_id = sl.id
       LEFT JOIN public.appointments a ON a.staff_member_id = sm.id
       LEFT JOIN public.appointment_line_items ali ON ali.appointment_id = a.id
       WHERE sm.id = $1 AND sl.business_account_id = $2
       GROUP BY sm.id, sm.commission_percentage`,
      [staffId, businessAccountId],
    );
  },

  // ── BIZ-13: Get Subscription ──
  async getSubscription(_businessAccountId: string) {
    // subscriptions table not yet implemented — return null (free tier)
    return null;
  },

  // ── Locations list ──
  async listLocations(businessAccountId: string) {
    const result = await query(
      `SELECT sl.*,
              ST_Y(sl.coordinates::geometry) AS latitude,
              ST_X(sl.coordinates::geometry) AS longitude
       FROM public.salon_locations sl
       WHERE sl.business_account_id = $1
       ORDER BY sl.created_at DESC`,
      [businessAccountId],
    );
    return result.rows;
  },
};
