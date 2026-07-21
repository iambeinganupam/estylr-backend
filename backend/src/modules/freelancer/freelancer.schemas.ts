// ─────────────────────────────────────────────────────────────────────────────
// Freelancer Module — Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────
// Inputs only. All schemas are exported individually for use by the controller
// and re-used by tests. Output shapes are inferred from repository return types.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateString = z.string().regex(dateRegex, 'Must be YYYY-MM-DD');

// ── Profile ──────────────────────────────────────────────────────────────────

// Optional URL that also accepts empty string (to allow "clear" via the UI).
const optionalUrl = z
  .union([z.string().url().max(500), z.literal('')])
  .optional();

export const updateFreelancerProfileSchema = z
  .object({
    business_name: z.string().min(1).max(200).optional(),
    display_name: z.string().min(1).max(200).optional(),
    bio: z.string().max(2000).optional(),
    logo_url: z.string().url().max(500).optional(),
    cover_image_url: z.string().url().max(500).optional(),
    address_line1: z.string().max(255).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postal_code: z.string().max(20).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    contact_phone: z.string().max(20).optional(),
    // Empty string normalises to null so the user can clear a saved value.
    // Distinct from `users.email` identity (which lives on the users table).
    contact_email: z.string().email().max(255).optional()
      .or(z.literal('').transform(() => null)),
    category: z.string().max(100).optional(),
    gender_preference: z.enum(['male', 'female', 'unisex', 'no_preference']).optional(),
    starting_price: z.number().nonnegative().max(999999.99).optional(),
    hourly_rate: z.number().nonnegative().max(999999.99).optional(),
    years_of_experience: z.number().int().min(0).max(80).optional(),
    availability_summary: z.string().max(100).optional(),
    instagram_url: optionalUrl,
    youtube_url: optionalUrl,
    website_url: optionalUrl,
    is_open_to_work: z.boolean().optional(),
    // Vendor-collected payment identity (Phase 1: manual UPI). Empty
    // string normalises to null so the user can clear a saved value.
    upi_id: z.string()
      .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/, 'Must be a valid UPI VPA, e.g. you@upi')
      .max(255)
      .optional()
      .or(z.literal('').transform(() => null)),
    upi_display_name: z.string().min(1).max(120).optional()
      .or(z.literal('').transform(() => null)),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .refine(
    (v) => (v.latitude == null) === (v.longitude == null),
    { message: 'latitude and longitude must be provided together', path: ['latitude'] },
  );

// ── Presence ─────────────────────────────────────────────────────────────────
// Toggle whether the freelancer is currently online and accepting bookings.
// Carried separately from profile updates so the route can grow its own
// observability + rate-limit story without touching profile-edit semantics.

export const setPresenceSchema = z
  .object({
    is_online: z.boolean(),
  })
  .strict();

// ── Experience ───────────────────────────────────────────────────────────────

export const createExperienceSchema = z
  .object({
    role: z.string().min(1).max(150),
    company: z.string().min(1).max(200),
    location: z.string().max(200).optional(),
    start_date: dateString,
    end_date: dateString.nullable().optional(),
    is_current: z.boolean().optional().default(false),
    highlights: z.array(z.string().max(500)).max(20).optional().default([]),
    display_order: z.number().int().min(0).max(1000).optional().default(0),
  })
  .strict()
  .refine(
    (v) => !v.end_date || !v.start_date || v.end_date >= v.start_date,
    { message: 'end_date must be on or after start_date', path: ['end_date'] },
  );

export const updateExperienceSchema = createExperienceSchema.innerType().partial().strict();

// ── Skills ───────────────────────────────────────────────────────────────────

export const createSkillSchema = z
  .object({
    category: z.string().min(1).max(100),
    skill_name: z.string().min(1).max(150),
  })
  .strict();

// ── Certifications ───────────────────────────────────────────────────────────

export const createCertificationSchema = z
  .object({
    name: z.string().min(1).max(200),
    issuer: z.string().max(200).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    credential_url: z.string().url().max(500).optional(),
  })
  .strict();

// ── Languages ────────────────────────────────────────────────────────────────

export const createLanguageSchema = z
  .object({
    language: z.string().min(1).max(80),
    proficiency: z.string().max(40).optional(),
  })
  .strict();

// ── Salon Associations (resume-style salon history) ──────────────────────────

export const createSalonAssociationSchema = z
  .object({
    salon_name: z.string().min(1).max(200),
    salon_location_id: z.string().uuid().optional(),
    location: z.string().max(200).optional(),
    start_date: dateString,
    end_date: dateString.nullable().optional(),
    is_current: z.boolean().optional().default(false),
  })
  .strict()
  .refine(
    (v) => !v.end_date || !v.start_date || v.end_date >= v.start_date,
    { message: 'end_date must be on or after start_date', path: ['end_date'] },
  );

export const updateSalonAssociationSchema = createSalonAssociationSchema
  .innerType()
  .partial()
  .strict();

// ── Preferences ──────────────────────────────────────────────────────────────

export const updatePreferencesSchema = z
  .object({
    notif_bookings: z.boolean().optional(),
    notif_reminders: z.boolean().optional(),
    notif_payments: z.boolean().optional(),
    notif_promos: z.boolean().optional(),
    language: z.string().min(2).max(10).optional(),
    dark_mode: z.boolean().optional(),
    low_data_mode: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

// ── Performance Query ────────────────────────────────────────────────────────

export const performanceQuerySchema = z
  .object({
    range: z.enum(['7d', '30d', '90d', '1y']).optional().default('30d'),
  })
  .strict();

// ── Path Params ──────────────────────────────────────────────────────────────

export const idParamSchema = z.object({ id: z.string().uuid('Invalid ID') });
