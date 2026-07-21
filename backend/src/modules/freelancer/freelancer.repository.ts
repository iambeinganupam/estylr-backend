// ─────────────────────────────────────────────────────────────────────────────
// Freelancer Module — Repository (raw SQL via pg)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data access. No business logic. Every function takes the freelancer's
// own freelancer_profiles.id (resolved from req.auth in the controller layer).
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { DatabaseError, ResourceNotFoundError } from '../../lib/errors';

// ── Types (output shapes) ────────────────────────────────────────────────────

export interface FreelancerProfileRow {
  id: string;
  user_id: string;
  business_name: string;
  display_name: string | null;
  bio: string | null;
  url_slug: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country_code: string;
  contact_phone: string | null;
  contact_email: string | null;
  category: string | null;
  gender_preference: string | null;
  is_verified: boolean;
  is_active: boolean;
  is_open_to_work: boolean;
  online_since_at: string | null;
  avg_rating: number;
  review_count: number;
  starting_price: number | null;
  hourly_rate: number | null;
  years_of_experience: number | null;
  availability_summary: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  latitude: number | null;
  longitude: number | null;
  commission_percentage: number;
  created_at: string;
  updated_at: string;
  // Joined from users
  first_name: string | null;
  last_name: string | null;
  email: string;
}

export interface ExperienceRow {
  id: string;
  freelancer_id: string;
  role: string;
  company: string;
  location: string | null;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
  highlights: string[];
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface SkillRow {
  id: string;
  freelancer_id: string;
  category: string;
  skill_name: string;
  endorsement_count: number;
  created_at: string;
}

export interface CertificationRow {
  id: string;
  freelancer_id: string;
  name: string;
  issuer: string | null;
  year: number | null;
  credential_url: string | null;
  created_at: string;
}

export interface LanguageRow {
  id: string;
  freelancer_id: string;
  language: string;
  proficiency: string | null;
}

export interface SalonAssociationRow {
  id: string;
  freelancer_id: string;
  salon_name: string;
  salon_location_id: string | null;
  location: string | null;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
  created_at: string;
}

export interface PreferencesRow {
  user_id: string;
  notif_bookings: boolean;
  notif_reminders: boolean;
  notif_payments: boolean;
  notif_promos: boolean;
  language: string;
  dark_mode: boolean;
  low_data_mode: boolean;
  updated_at: string;
}

// ── SQL field whitelists (used for safe dynamic UPDATE building) ─────────────

const PROFILE_UPDATE_FIELDS = [
  'business_name',
  'display_name',
  'bio',
  'logo_url',
  'cover_image_url',
  'address_line1',
  'city',
  'state',
  'postal_code',
  'contact_phone',
  'contact_email',
  'category',
  'gender_preference',
  'starting_price',
  'is_open_to_work',
  'years_of_experience',
  'hourly_rate',
  'availability_summary',
  'instagram_url',
  'youtube_url',
  'website_url',
  'upi_id',
  'upi_display_name',
] as const;

const EXPERIENCE_UPDATE_FIELDS = [
  'role',
  'company',
  'location',
  'start_date',
  'end_date',
  'is_current',
  'highlights',
  'display_order',
] as const;

const SALON_ASSOCIATION_UPDATE_FIELDS = [
  'salon_name',
  'salon_location_id',
  'location',
  'start_date',
  'end_date',
  'is_current',
] as const;

const PREFERENCE_FIELDS = [
  'notif_bookings',
  'notif_reminders',
  'notif_payments',
  'notif_promos',
  'language',
  'dark_mode',
  'low_data_mode',
] as const;

function buildPatch<T extends readonly string[]>(
  whitelist: T,
  patch: Record<string, unknown>,
): { setClause: string; values: unknown[] } {
  const values: unknown[] = [];
  const sets: string[] = [];
  for (const field of whitelist) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      values.push(patch[field]);
      sets.push(`${field} = $${values.length}`);
    }
  }
  return { setClause: sets.join(', '), values };
}

// ── Repository ───────────────────────────────────────────────────────────────

export const freelancerRepository = {
  // ── Profile ───────────────────────────────────────────────────────────────

  async getProfile(freelancerId: string): Promise<FreelancerProfileRow | null> {
    return queryOne<FreelancerProfileRow>(
      `SELECT
         fp.id, fp.user_id, fp.business_name, fp.display_name, fp.bio,
         fp.url_slug,
         fp.logo_url, fp.cover_image_url,
         fp.address_line1, fp.city, fp.state, fp.postal_code, fp.country_code,
         fp.contact_phone, fp.contact_email, fp.category, fp.gender_preference,
         fp.is_verified, fp.is_active, fp.is_open_to_work, fp.online_since_at,
         fp.avg_rating, fp.review_count, fp.starting_price, fp.commission_percentage,
         fp.hourly_rate, fp.years_of_experience, fp.availability_summary,
         fp.instagram_url, fp.youtube_url, fp.website_url,
         ST_Y(fp.coordinates::geometry) AS latitude,
         ST_X(fp.coordinates::geometry) AS longitude,
         fp.created_at, fp.updated_at,
         u.first_name, u.last_name, u.email
       FROM public.freelancer_profiles fp
       JOIN public.users u ON u.id = fp.user_id
       WHERE fp.id = $1`,
      [freelancerId],
    );
  },

  async updateProfile(
    freelancerId: string,
    patch: Record<string, unknown>,
  ): Promise<FreelancerProfileRow | null> {
    const { latitude, longitude, ...scalarPatch } = patch as Record<string, unknown> & {
      latitude?: number;
      longitude?: number;
    };
    const { setClause, values } = buildPatch(PROFILE_UPDATE_FIELDS, scalarPatch);
    const setClauses = setClause ? [setClause] : [];

    if (typeof latitude === 'number' && typeof longitude === 'number') {
      values.push(longitude, latitude);
      setClauses.push(
        `coordinates = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)`,
      );
    }

    if (setClauses.length === 0) return this.getProfile(freelancerId);

    values.push(freelancerId);
    try {
      await query(
        `UPDATE public.freelancer_profiles
           SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length}`,
        values,
      );
    } catch (e) { mapPgError(e); }
    return this.getProfile(freelancerId);
  },

  // ── Presence ──────────────────────────────────────────────────────────────
  // Atomic, idempotent transition. The CASE preserves the existing
  // online_since_at on an online→online no-op, stamps NOW() on offline→online,
  // and clears the timestamp on any →offline transition. The DB CHECK
  // constraint (freelancer_profiles_presence_consistency) defends against
  // partial writes if this branching ever drifts.
  async setPresence(
    freelancerId: string,
    isOnline: boolean,
  ): Promise<{ is_open_to_work: boolean; online_since_at: string | null } | null> {
    return queryOne<{ is_open_to_work: boolean; online_since_at: string | null }>(
      `UPDATE public.freelancer_profiles
          SET is_open_to_work = $2,
              online_since_at = CASE
                WHEN $2 = TRUE  AND is_open_to_work = FALSE THEN NOW()
                WHEN $2 = TRUE  AND is_open_to_work = TRUE  THEN online_since_at
                ELSE NULL
              END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING is_open_to_work, online_since_at`,
      [freelancerId, isOnline],
    );
  },

  // ── Experience ────────────────────────────────────────────────────────────

  async listExperience(freelancerId: string): Promise<ExperienceRow[]> {
    const result = await query<ExperienceRow>(
      `SELECT id, freelancer_id, role, company, location, start_date, end_date,
              is_current, highlights, display_order, created_at, updated_at
         FROM public.freelancer_experience
        WHERE freelancer_id = $1
        ORDER BY display_order ASC, is_current DESC, start_date DESC`,
      [freelancerId],
    );
    return result.rows;
  },

  async createExperience(
    freelancerId: string,
    input: {
      role: string;
      company: string;
      location?: string;
      start_date: string;
      end_date?: string | null;
      is_current?: boolean;
      highlights?: string[];
      display_order?: number;
    },
  ): Promise<ExperienceRow> {
    try {
      const row = await queryOne<ExperienceRow>(
        `INSERT INTO public.freelancer_experience
           (freelancer_id, role, company, location, start_date, end_date,
            is_current, highlights, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, freelancer_id, role, company, location, start_date, end_date,
                   is_current, highlights, display_order, created_at, updated_at`,
        [
          freelancerId,
          input.role,
          input.company,
          input.location ?? null,
          input.start_date,
          input.end_date ?? null,
          input.is_current ?? false,
          input.highlights ?? [],
          input.display_order ?? 0,
        ],
      );
      if (!row) throw new DatabaseError('Failed to create experience');
      return row;
    } catch (e) { mapPgError(e); }
  },

  async updateExperience(
    freelancerId: string,
    experienceId: string,
    patch: Record<string, unknown>,
  ): Promise<ExperienceRow | null> {
    const { setClause, values } = buildPatch(EXPERIENCE_UPDATE_FIELDS, patch);
    if (!setClause) return this.findExperience(freelancerId, experienceId);

    values.push(experienceId, freelancerId);
    try {
      return await queryOne<ExperienceRow>(
        `UPDATE public.freelancer_experience
            SET ${setClause}, updated_at = NOW()
          WHERE id = $${values.length - 1} AND freelancer_id = $${values.length}
          RETURNING id, freelancer_id, role, company, location, start_date, end_date,
                    is_current, highlights, display_order, created_at, updated_at`,
        values,
      );
    } catch (e) { mapPgError(e); }
  },

  async findExperience(
    freelancerId: string,
    experienceId: string,
  ): Promise<ExperienceRow | null> {
    return queryOne<ExperienceRow>(
      `SELECT id, freelancer_id, role, company, location, start_date, end_date,
              is_current, highlights, display_order, created_at, updated_at
         FROM public.freelancer_experience
        WHERE id = $1 AND freelancer_id = $2`,
      [experienceId, freelancerId],
    );
  },

  async deleteExperience(freelancerId: string, experienceId: string): Promise<boolean> {
    try {
      const result = await query(
        `DELETE FROM public.freelancer_experience
          WHERE id = $1 AND freelancer_id = $2`,
        [experienceId, freelancerId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (e) { mapPgError(e); }
  },

  // ── Skills ────────────────────────────────────────────────────────────────

  async listSkills(freelancerId: string): Promise<SkillRow[]> {
    const result = await query<SkillRow>(
      `SELECT id, freelancer_id, category, skill_name, endorsement_count, created_at
         FROM public.freelancer_skills
        WHERE freelancer_id = $1
        ORDER BY category ASC, skill_name ASC`,
      [freelancerId],
    );
    return result.rows;
  },

  async createSkill(
    freelancerId: string,
    input: { category: string; skill_name: string },
  ): Promise<SkillRow> {
    try {
      const row = await queryOne<SkillRow>(
        `INSERT INTO public.freelancer_skills (freelancer_id, category, skill_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (freelancer_id, category, skill_name) DO UPDATE
           SET skill_name = EXCLUDED.skill_name
         RETURNING id, freelancer_id, category, skill_name, endorsement_count, created_at`,
        [freelancerId, input.category, input.skill_name],
      );
      if (!row) throw new DatabaseError('Failed to create skill');
      return row;
    } catch (e) { mapPgError(e); }
  },

  async deleteSkill(freelancerId: string, skillId: string): Promise<boolean> {
    try {
      const result = await query(
        `DELETE FROM public.freelancer_skills
          WHERE id = $1 AND freelancer_id = $2`,
        [skillId, freelancerId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (e) { mapPgError(e); }
  },

  // ── Certifications ────────────────────────────────────────────────────────

  async listCertifications(freelancerId: string): Promise<CertificationRow[]> {
    const result = await query<CertificationRow>(
      `SELECT id, freelancer_id, name, issuer, year, credential_url, created_at
         FROM public.freelancer_certifications
        WHERE freelancer_id = $1
        ORDER BY COALESCE(year, 0) DESC, name ASC`,
      [freelancerId],
    );
    return result.rows;
  },

  async createCertification(
    freelancerId: string,
    input: { name: string; issuer?: string; year?: number; credential_url?: string },
  ): Promise<CertificationRow> {
    try {
      const row = await queryOne<CertificationRow>(
        `INSERT INTO public.freelancer_certifications
           (freelancer_id, name, issuer, year, credential_url)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, freelancer_id, name, issuer, year, credential_url, created_at`,
        [
          freelancerId,
          input.name,
          input.issuer ?? null,
          input.year ?? null,
          input.credential_url ?? null,
        ],
      );
      if (!row) throw new DatabaseError('Failed to create certification');
      return row;
    } catch (e) { mapPgError(e); }
  },

  async deleteCertification(freelancerId: string, certificationId: string): Promise<boolean> {
    try {
      const result = await query(
        `DELETE FROM public.freelancer_certifications
          WHERE id = $1 AND freelancer_id = $2`,
        [certificationId, freelancerId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (e) { mapPgError(e); }
  },

  // ── Languages ─────────────────────────────────────────────────────────────

  async listLanguages(freelancerId: string): Promise<LanguageRow[]> {
    const result = await query<LanguageRow>(
      `SELECT id, freelancer_id, language, proficiency
         FROM public.freelancer_languages
        WHERE freelancer_id = $1
        ORDER BY language ASC`,
      [freelancerId],
    );
    return result.rows;
  },

  async createLanguage(
    freelancerId: string,
    input: { language: string; proficiency?: string },
  ): Promise<LanguageRow> {
    try {
      const row = await queryOne<LanguageRow>(
        `INSERT INTO public.freelancer_languages (freelancer_id, language, proficiency)
         VALUES ($1, $2, $3)
         ON CONFLICT (freelancer_id, language) DO UPDATE
           SET proficiency = EXCLUDED.proficiency
         RETURNING id, freelancer_id, language, proficiency`,
        [freelancerId, input.language, input.proficiency ?? null],
      );
      if (!row) throw new DatabaseError('Failed to create language');
      return row;
    } catch (e) { mapPgError(e); }
  },

  async deleteLanguage(freelancerId: string, languageId: string): Promise<boolean> {
    try {
      const result = await query(
        `DELETE FROM public.freelancer_languages
          WHERE id = $1 AND freelancer_id = $2`,
        [languageId, freelancerId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (e) { mapPgError(e); }
  },

  // ── Salon Associations ────────────────────────────────────────────────────

  async listSalonAssociations(freelancerId: string): Promise<SalonAssociationRow[]> {
    const result = await query<SalonAssociationRow>(
      `SELECT id, freelancer_id, salon_name, salon_location_id, location,
              start_date, end_date, is_current, created_at
         FROM public.freelancer_salon_associations
        WHERE freelancer_id = $1
        ORDER BY is_current DESC, start_date DESC`,
      [freelancerId],
    );
    return result.rows;
  },

  async createSalonAssociation(
    freelancerId: string,
    input: {
      salon_name: string;
      salon_location_id?: string;
      location?: string;
      start_date: string;
      end_date?: string | null;
      is_current?: boolean;
    },
  ): Promise<SalonAssociationRow> {
    try {
      const row = await queryOne<SalonAssociationRow>(
        `INSERT INTO public.freelancer_salon_associations
           (freelancer_id, salon_name, salon_location_id, location,
            start_date, end_date, is_current)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, freelancer_id, salon_name, salon_location_id, location,
                   start_date, end_date, is_current, created_at`,
        [
          freelancerId,
          input.salon_name,
          input.salon_location_id ?? null,
          input.location ?? null,
          input.start_date,
          input.end_date ?? null,
          input.is_current ?? false,
        ],
      );
      if (!row) throw new DatabaseError('Failed to create salon association');
      return row;
    } catch (e) { mapPgError(e); }
  },

  async updateSalonAssociation(
    freelancerId: string,
    associationId: string,
    patch: Record<string, unknown>,
  ): Promise<SalonAssociationRow | null> {
    const { setClause, values } = buildPatch(SALON_ASSOCIATION_UPDATE_FIELDS, patch);
    if (!setClause) return this.findSalonAssociation(freelancerId, associationId);

    values.push(associationId, freelancerId);
    try {
      return await queryOne<SalonAssociationRow>(
        `UPDATE public.freelancer_salon_associations
            SET ${setClause}
          WHERE id = $${values.length - 1} AND freelancer_id = $${values.length}
          RETURNING id, freelancer_id, salon_name, salon_location_id, location,
                    start_date, end_date, is_current, created_at`,
        values,
      );
    } catch (e) { mapPgError(e); }
  },

  async findSalonAssociation(
    freelancerId: string,
    associationId: string,
  ): Promise<SalonAssociationRow | null> {
    return queryOne<SalonAssociationRow>(
      `SELECT id, freelancer_id, salon_name, salon_location_id, location,
              start_date, end_date, is_current, created_at
         FROM public.freelancer_salon_associations
        WHERE id = $1 AND freelancer_id = $2`,
      [associationId, freelancerId],
    );
  },

  async deleteSalonAssociation(freelancerId: string, associationId: string): Promise<boolean> {
    try {
      const result = await query(
        `DELETE FROM public.freelancer_salon_associations
          WHERE id = $1 AND freelancer_id = $2`,
        [associationId, freelancerId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (e) { mapPgError(e); }
  },

  // ── Performance (computed from existing tables) ───────────────────────────

  async getPerformanceMetrics(
    freelancerId: string,
    rangeStart: string,
    rangeEnd: string,
  ): Promise<{
    total_services: number;
    completed_services: number;
    total_clients: number;
    repeat_clients: number;
    avg_service_minutes: number;
    on_time_percent: number;
    total_revenue: number;
    avg_rating: number;
    review_count: number;
  }> {
    const row = await queryOne<{
      total_services: string;
      completed_services: string;
      total_clients: string;
      repeat_clients: string;
      avg_service_minutes: string | null;
      on_time_percent: string | null;
      total_revenue: string | null;
      avg_rating: string | null;
      review_count: string;
    }>(
      `WITH window_appts AS (
         SELECT a.*
           FROM public.appointments a
          WHERE a.vendor_type = 'freelancer'
            AND a.vendor_id = $1
            AND a.start_time >= $2::date::timestamptz
            AND a.start_time < ($3::date + INTERVAL '1 day')::timestamptz
       ),
       client_freq AS (
         SELECT customer_id, COUNT(*) AS visits
           FROM window_appts
          WHERE customer_id IS NOT NULL AND status = 'completed'
          GROUP BY customer_id
       )
       SELECT
         COUNT(*) FILTER (WHERE status NOT IN ('cancelled')) AS total_services,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_services,
         COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL) AS total_clients,
         COALESCE((SELECT COUNT(*) FROM client_freq WHERE visits > 1), 0) AS repeat_clients,
         AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60)
           FILTER (WHERE status = 'completed') AS avg_service_minutes,
         (COUNT(*) FILTER (WHERE status = 'completed' AND end_time <= start_time + INTERVAL '5 min' + (end_time - start_time))::numeric * 100
           / NULLIF(COUNT(*) FILTER (WHERE status = 'completed'), 0)) AS on_time_percent,
         (SELECT COALESCE(SUM(t.amount), 0)
            FROM public.transactions t
            JOIN window_appts wa ON wa.id = t.appointment_id
           WHERE t.status = 'completed') AS total_revenue,
         (SELECT AVG(rating)
            FROM public.reviews
           WHERE vendor_type = 'freelancer' AND vendor_id = $1
             AND created_at >= $2::date::timestamptz
             AND created_at < ($3::date + INTERVAL '1 day')::timestamptz) AS avg_rating,
         (SELECT COUNT(*)
            FROM public.reviews
           WHERE vendor_type = 'freelancer' AND vendor_id = $1
             AND created_at >= $2::date::timestamptz
             AND created_at < ($3::date + INTERVAL '1 day')::timestamptz) AS review_count
       FROM window_appts`,
      [freelancerId, rangeStart, rangeEnd],
    );

    return {
      total_services: Number(row?.total_services ?? 0),
      completed_services: Number(row?.completed_services ?? 0),
      total_clients: Number(row?.total_clients ?? 0),
      repeat_clients: Number(row?.repeat_clients ?? 0),
      avg_service_minutes: Number(row?.avg_service_minutes ?? 0),
      on_time_percent: Number(row?.on_time_percent ?? 0),
      total_revenue: Number(row?.total_revenue ?? 0),
      avg_rating: row?.avg_rating != null ? Number(row.avg_rating) : 0,
      review_count: Number(row?.review_count ?? 0),
    };
  },

  // ── Preferences ───────────────────────────────────────────────────────────

  async getPreferences(userId: string): Promise<PreferencesRow | null> {
    return queryOne<PreferencesRow>(
      `SELECT user_id, notif_bookings, notif_reminders, notif_payments, notif_promos,
              language, dark_mode, low_data_mode, updated_at
         FROM public.user_preferences
        WHERE user_id = $1`,
      [userId],
    );
  },

  async upsertPreferences(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<PreferencesRow> {
    const sets: string[] = [];
    const values: unknown[] = [userId];

    for (const field of PREFERENCE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) {
        values.push(patch[field]);
        sets.push(`${field} = EXCLUDED.${field}`);
      }
    }

    const sql = sets.length
      ? `INSERT INTO public.user_preferences (user_id) VALUES ($1)
           ON CONFLICT (user_id) DO UPDATE
             SET ${sets.join(', ')}, updated_at = NOW()
         RETURNING user_id, notif_bookings, notif_reminders, notif_payments, notif_promos,
                   language, dark_mode, low_data_mode, updated_at`
      : `INSERT INTO public.user_preferences (user_id) VALUES ($1)
           ON CONFLICT (user_id) DO NOTHING
         RETURNING user_id, notif_bookings, notif_reminders, notif_payments, notif_promos,
                   language, dark_mode, low_data_mode, updated_at`;

    try {
      const row = await queryOne<PreferencesRow>(sql, values);
      if (row) return row;
    } catch (e) { mapPgError(e); }
    // The row already existed and no fields changed — fetch and return.
    const existing = await this.getPreferences(userId);
    if (!existing) throw new ResourceNotFoundError('user_preferences');
    return existing;
  },
};
