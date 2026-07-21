// ─────────────────────────────────────────────────────────────────────────────
// Discovery Module — Schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { CATEGORY_AUDIENCE } from '../../lib/constants';

/** Audience filter for the public categories surface. Single value;
 *  controller widens 'grooming' / 'wedding' to `(<value>, 'both')` at the
 *  repo level so callers always get rows tagged 'both' alongside their own
 *  audience. Omitted = grooming (preserves legacy behaviour). */
export const categoriesAudienceEnum = z.enum([
  CATEGORY_AUDIENCE.GROOMING,
  CATEGORY_AUDIENCE.WEDDING,
  CATEGORY_AUDIENCE.BOTH,
]);

export const categoriesQuery = z.object({
  audience: categoriesAudienceEnum.optional(),
});

/** GET /discover/categories/:slug — DB-backed slug lookup for root-level
 *  category pages. Returns the root plus its subcategories. */
export const categoryBySlugParam = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, hyphens'),
});

// ── DISC v2 — extended search schema ──
// Adds: city, gender_target (canonical), service_mode (API values salon|home|both),
// open_now, and new sort_by values (relevance, rating_desc, price_asc, price_desc,
// popularity). Preserves `gender` (alias) and `available_today` because existing
// downstream code + integration tests still rely on them.
export const searchSchema = z.object({
  q: z.string().min(1).max(100).optional(),
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),

  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  city: z.string().min(1).max(60).optional(),
  radius_km: z.coerce.number().min(1).max(100).default(10),

  category: z.string().optional(),
  service_id: z.string().uuid().optional(),
  gender: z.enum(['male', 'female', 'unisex']).optional(),
  gender_target: z.enum(['male', 'female', 'unisex']).optional(),
  service_mode: z.enum(['home', 'onsite', 'both']).optional(),
  open_now: z
    .string()
    .transform((s) => s === 'true')
    .optional(),
  min_rating: z.coerce.number().min(0).max(5).optional(),
  min_price: z.coerce.number().int().min(0).optional(),
  max_price: z.coerce.number().int().min(0).optional(),
  available_today: z
    .string()
    .transform((s) => s === 'true')
    .optional(),

  sort_by: z
    .enum(['relevance', 'distance', 'rating_desc', 'price_asc', 'price_desc', 'popularity'])
    .default('distance'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
}).refine(
  (v) => v.min_price === undefined || v.max_price === undefined || v.min_price <= v.max_price,
  { message: 'min_price must be ≤ max_price', path: ['max_price'] },
);

// Generic slug param (lowercase letters, digits, hyphens). Used by R1 discovery
// surfaces such as vendor-by-slug and city-by-slug. Mirrors existing
// bySlugParam / categoryBySlugParam regex but kept as a separate export so new
// routes can wire against a canonical name.
export const slugParam = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, hyphens'),
});

// GET /discover/autocomplete — typeahead. `q` required; geo hints optional.
export const autocompleteQuery = z.object({
  q: z.string().min(1).max(60),
  city: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

// GET /discover/near-you — geo-mandatory listing.
export const nearYouQuery = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const vendorDetailParam = z.object({
  vendorType: z.enum(['freelancer', 'salon']),
  vendorId: z.string().uuid(),
});

export const vendorReviewsParam = z.object({
  id: z.string().uuid(),
});

export const vendorReviewsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  sort: z.enum(['recent', 'highest', 'lowest']).default('recent'),
});

// Path params for POST /discovery/vendors/:vendorType/:vendorId/view
export const trackViewParam = z.object({
  vendorType: z.enum(['freelancer', 'salon_location']),
  vendorId: z.string().uuid(),
});

// ── B4: by-slug param + query ──
export const bySlugParam = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, hyphens'),
});

export const bySlugQuery = z.object({
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
});

// ── B2: featured query ──
export const featuredQuery = z.object({
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

// ── B3: trending query ──
export const trendingQuery = z.object({
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});
