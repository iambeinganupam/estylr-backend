// ─────────────────────────────────────────────────────────────────────────────
// Admin Vendors — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

// `z.coerce.boolean()` treats any non-empty string as true ("false" → true),
// which is wrong for URL params. Parse the literal strings instead.
const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
).optional();

export const VENDOR_TYPE_FILTER = z.enum(['freelancer', 'salon', 'all']);
export const KYC_STATUS_FILTER = z.enum(['pending', 'approved', 'all']);

export const vendorListSchema = z.object({
  type:        VENDOR_TYPE_FILTER.optional().default('all'),
  kyc_status:  KYC_STATUS_FILTER.optional().default('all'),
  is_active:   queryBool,
  city:        z.string().trim().max(100).optional(),
  joined_from: isoDate.optional(),
  joined_to:   isoDate.optional(),
  search:      z.string().trim().max(120).optional(),
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
  sort:        z.enum(['created_at:desc', 'created_at:asc', 'name:asc', 'name:desc']).default('created_at:desc'),
});
export type VendorListQuery = z.infer<typeof vendorListSchema>;

export const vendorIdParam = z.object({
  id: z.string().uuid(),
});

// Full edit — every field on freelancer_profiles / salon_locations / business_accounts
// that an admin is allowed to mutate. Empty body is rejected; `reason` is logged
// in the audit trail. Salon-only fields silently no-op on freelancers and vice
// versa — the service layer routes the patch to the correct table.
export const vendorUpdateSchema = z.object({
  // Status
  is_active:             z.boolean().optional(),
  is_verified:           z.boolean().optional(),

  // Identity (freelancer + salon)
  business_name:         z.string().trim().min(1).max(200).optional(),
  display_name:          z.string().trim().max(200).nullable().optional(),
  bio:                   z.string().trim().max(2000).nullable().optional(),
  category:              z.string().trim().max(100).nullable().optional(),
  gender_preference:     z.enum(['male', 'female', 'unisex', 'no_preference']).nullable().optional(),
  starting_price:        z.number().min(0).nullable().optional(),

  // Contact
  contact_phone:         z.string().trim().max(20).nullable().optional(),
  contact_email:         z.string().email().max(255).nullable().optional(),

  // Address
  address_line1:         z.string().trim().max(255).nullable().optional(),
  address_line2:         z.string().trim().max(255).nullable().optional(),
  city:                  z.string().trim().max(100).nullable().optional(),
  state:                 z.string().trim().max(100).nullable().optional(),
  postal_code:           z.string().trim().max(20).nullable().optional(),
  country_code:          z.string().trim().length(2).optional(),

  // Media
  logo_url:              z.string().url().max(500).nullable().optional(),
  cover_url:             z.string().url().max(500).nullable().optional(),

  // URL slug (salons only)
  url_slug:              z.string().trim().max(255).nullable().optional(),

  // Commercial (freelancer only — salons inherit from business plan)
  commission_percentage: z.number().min(0).max(100).optional(),
  upi_id:                z.string().trim().max(255).nullable().optional(),
  upi_display_name:      z.string().trim().max(120).nullable().optional(),

  reason:                z.string().trim().max(500).optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'reason' && v[k as keyof typeof v] !== undefined),
  { message: 'At least one writable field is required' },
);
export type VendorUpdateBody = z.infer<typeof vendorUpdateSchema>;

// Create vendor — admin can manually onboard a freelancer or salon. We also
// create the underlying user row (auth via password reset link in v2; for v1
// we accept an explicit phone/email and rely on the OTP flow to set a password).
export const vendorCreateSchema = z.discriminatedUnion('vendor_type', [
  z.object({
    vendor_type:        z.literal('freelancer'),
    business_name:      z.string().trim().min(1).max(200),
    display_name:       z.string().trim().max(200).optional(),
    email:              z.string().email().max(255),
    phone_number:       z.string().trim().max(20).optional(),
    city:               z.string().trim().max(100).optional(),
    category:           z.string().trim().max(100).optional(),
    starting_price:     z.number().min(0).optional(),
    commission_percentage: z.number().min(0).max(100).optional(),
  }),
  z.object({
    vendor_type:        z.literal('salon_location'),
    legal_business_name: z.string().trim().min(1).max(255),
    brand_name:          z.string().trim().max(200).optional(),
    display_name:        z.string().trim().min(1).max(200),
    owner_email:         z.string().email().max(255),
    owner_phone:         z.string().trim().max(20).optional(),
    city:                z.string().trim().max(100).optional(),
    address_line1:       z.string().trim().max(255).optional(),
    state:               z.string().trim().max(100).optional(),
    postal_code:         z.string().trim().max(20).optional(),
  }),
]);
export type VendorCreateBody = z.infer<typeof vendorCreateSchema>;

export const vendorDeleteSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type VendorDeleteBody = z.infer<typeof vendorDeleteSchema>;
