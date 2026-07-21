// ─────────────────────────────────────────────────────────────────────────────
// Business Module — Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

// ── Shared ──
const uuidParam = z.object({
  id: z.string().uuid('Invalid ID format'),
});

// One certification entry on a salon profile. Free-text by design — promote to
// a normalised table only once moderation / verification workflows are needed.
export const certificationSchema = z.object({
  name: z.string().min(1).max(150),
  issuer: z.string().min(1).max(150),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 1),
  credential_id: z.string().max(100).optional(),
});

// Closed amenity taxonomy. Mirrored as `SALON_AMENITY_KEYS` in
// `@kshuri/api-client` so every consumer (salon-dashboard, customer-dashboard,
// admin, public portal) shares one source of truth. Add new keys at the end —
// don't reorder, and don't remove without a migration that backfills.
export const SALON_AMENITY_KEYS = [
  'wifi',
  'parking',
  'air_conditioning',
  'wheelchair_accessible',
  'kid_friendly',
  'pet_friendly',
  'restroom',
  'water',
  'beverages',
  'music',
  'magazines',
  'charging_station',
  'private_rooms',
  'changing_room',
  'walk_ins_welcome',
  'online_booking',
  'gift_cards',
  'loyalty_program',
  'card_payment',
  'upi_payment',
  'cash_payment',
  'female_only',
] as const;
export type SalonAmenityKey = (typeof SALON_AMENITY_KEYS)[number];

// ── BIZ-02: Update Business Profile ──
// Address fields (address_line1/2, city, state, postal_code) are routed to the
// primary salon_locations row in the service layer; everything else updates
// business_accounts directly.
export const updateBusinessProfileSchema = z.object({
  legal_business_name: z.string().min(1).max(255).optional(),
  brand_name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  tagline: z.string().max(160).optional(),
  specializations: z.array(z.string().min(1).max(50)).max(20).optional(),
  languages: z.array(z.string().min(1).max(40)).max(20).optional(),
  logo_url: z.string().url().max(500).optional(),
  cover_image_url: z.string().url().max(500).optional(),
  website_url: z.string().url().max(500).optional(),
  instagram_url: z.string().url().max(500).optional(),
  youtube_url: z.string().url().max(500).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional(),
  address_line1: z.string().min(1).max(255).optional(),
  address_line2: z.string().max(255).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(100).optional(),
  postal_code: z.string().regex(/^\d{6}$/, 'Must be a 6-digit pincode').optional(),
  years_in_business: z.number().int().min(0).max(200).optional(),
  certifications: z.array(certificationSchema).max(20).optional(),
  amenities: z.array(z.enum(SALON_AMENITY_KEYS)).max(SALON_AMENITY_KEYS.length).optional(),
  // Vendor-collected payment identity (Phase 1: manual UPI). Empty string
  // is normalised to null so the user can clear a previously-saved value.
  upi_id: z.string()
    .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/, 'Must be a valid UPI VPA, e.g. salon@upi')
    .max(255)
    .optional()
    .or(z.literal('').transform(() => null)),
  upi_display_name: z.string().min(1).max(120).optional()
    .or(z.literal('').transform(() => null)),
});

// Fields routed to the primary salon_locations row instead of business_accounts.
// Despite the name, this list also includes location-physical attributes like
// `amenities` that live on the location row.
export const BUSINESS_ADDRESS_FIELDS = [
  'address_line1', 'address_line2', 'city', 'state', 'postal_code',
  'amenities',
] as const;

// ── BIZ-04: Update Location ──
export const updateLocationSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  address_line1: z.string().min(1).max(255).optional(),
  address_line2: z.string().max(255).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(100).optional(),
  pincode: z.string().regex(/^\d{6}$/, 'Must be 6-digit pincode').optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  is_active: z.boolean().optional(),
});

export const locationIdParam = z.object({
  locId: z.string().uuid('Invalid location ID'),
});

// ── BIZ-07: Invite Staff ──
// role is shape-only here (was a hardcoded z.enum that had already drifted
// from both constants.ts's STAFF_ROLE and the DB — it allowed 'junior_stylist',
// which staff_roles marks legacy/inactive, and disallowed 'admin'). Real
// validation is staffService.assertValidRoleCode() in business.service.ts,
// checked against the live staff_roles table.
export const inviteStaffSchema = z.object({
  email: z.string().email('Invalid email address'),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  role: z.string().trim().min(1).max(50),
  location_id: z.string().uuid('Invalid location ID').optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  commission_percentage: z.number().min(0).max(100).optional(),
});

// ── BIZ-08: Update Staff ──
export const updateStaffSchema = z.object({
  role: z.string().trim().min(1).max(50).optional(),
  commission_percentage: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
});

export const staffIdParam = z.object({
  staffId: z.string().uuid('Invalid staff ID'),
});

// ── BIZ-11: Update Billing Method ──
export const updateBillingMethodSchema = z.object({
  billing_method: z.enum(['online', 'offline', 'hybrid']),
  payment_gateway: z.string().optional(),
});

export { uuidParam };
