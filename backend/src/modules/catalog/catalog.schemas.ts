// ─────────────────────────────────────────────────────────────────────────────
// Catalog Module — Schemas + Repository + Service + Controller
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { SERVICE_LOCATION, CATEGORY_AUDIENCE } from '../../lib/constants';

/** Re-exported here so consumers don't need to reach into lib/constants. */
export const audienceEnum = z.enum([
  CATEGORY_AUDIENCE.GROOMING,
  CATEGORY_AUDIENCE.WEDDING,
  CATEGORY_AUDIENCE.BOTH,
]);

/**
 * "What's Included" bullet list. Vendors can pencil up to 10 short lines
 * surfaced in the service detail sheet under the description. Empty array
 * is valid — clients hide the section when there are no items.
 */
const inclusionsSchema = z
  .array(z.string().min(1).max(120))
  .max(10, 'Up to 10 inclusion bullets')
  .default([]);

const serviceLocationSchema = z.enum([
  SERVICE_LOCATION.ONSITE,
  SERVICE_LOCATION.HOME,
  SERVICE_LOCATION.BOTH,
]);

// ── CAT-02: Create Service ──
export const createServiceSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(100),
  description: z.string().max(500).optional(),
  duration_minutes: z.number().int().min(5, 'Minimum 5 minutes').max(480, 'Maximum 8 hours'),
  price: z.number().min(0, 'Price cannot be negative').max(999999.99),
  // Free-text category name — kept for legacy and analytics joins on
  // string match. Prefer `category_id` for new writes; the controller
  // backfills `category` from the resolved taxonomy row when an ID is
  // supplied so older readers (discovery filters, materialised views)
  // keep working without a data migration.
  category: z.string().min(1).max(100).optional(),
  /** FK into service_categories — populated by the shared CategoryPicker.
   *  When set, the backend looks up the row and writes both `category_id`
   *  and `category` (the row's name). */
  category_id: z.string().uuid('Invalid category ID').optional(),
  /** Free-text subcategory leaf name (mirrors how the form captures it).
   *  Until services.subcategory_id is added, we just persist the string. */
  subcategory: z.string().min(1).max(100).optional(),
  gender_target: z.enum(['male', 'female', 'unisex']).default('unisex'),
  is_active: z.boolean().default(true),
  inclusions: inclusionsSchema.optional(),
  service_location: serviceLocationSchema.default(SERVICE_LOCATION.ONSITE),
});

// ── CAT-03: Update Service ──
export const updateServiceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  price: z.number().min(0).max(999999.99).optional(),
  category: z.string().min(1).max(100).optional(),
  category_id: z.string().uuid('Invalid category ID').optional(),
  subcategory: z.string().min(1).max(100).optional(),
  gender_target: z.enum(['male', 'female', 'unisex']).optional(),
  is_active: z.boolean().optional(),
  is_trending: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  inclusions: inclusionsSchema.optional(),
  service_location: serviceLocationSchema.optional(),
});

// ── CAT-05: Staff Override ──
export const staffOverrideSchema = z.object({
  price: z.number().min(0).max(999999.99).nullable(),
  duration_minutes: z.number().int().min(5).max(480).nullable(),
});

export const serviceIdParam = z.object({
  id: z.string().uuid('Invalid service ID'),
});

// Public read-only id-param schemas (Task 2.1). Used by GET /services/:id/public
// and GET /products/:id/public — no auth, RSC-safe reads.
export const publicServiceIdParam = z.object({ id: z.string().uuid() });

export const serviceStaffParam = z.object({
  serviceId: z.string().uuid('Invalid service ID'),
  staffId: z.string().uuid('Invalid staff ID'),
});

// ── Query Params ──
export const catalogQuerySchema = z.object({
  category: z.string().optional(),
  gender: z.enum(['male', 'female', 'unisex']).optional(),
  active: z.enum(['true', 'false']).optional(),
});

// ── Products ──
export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(150),
  description: z.string().max(1000).optional(),
  category: z.string().max(50).optional(),
  price: z.number().min(0, 'Price cannot be negative').max(999999.99),
  stock: z.number().int().min(0, 'Stock cannot be negative').default(0),
  is_active: z.boolean().default(true),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(50).optional(),
  price: z.number().min(0).max(999999.99).optional(),
  stock: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

export const productIdParam = z.object({
  id: z.string().uuid('Invalid product ID'),
});

export const publicProductIdParam = z.object({ id: z.string().uuid() });

// ── Categories ─────────────────────────────────────────────────────────────
// Shared taxonomy table (`service_categories`) is hierarchical via parent_id.
// Vendors can create their own rows (scoped to vendor_type + vendor_id) and
// pick from global rows admins curate. Names are trimmed/length-checked here;
// case-insensitive uniqueness within a (vendor, parent) scope is enforced
// by partial unique indexes — see migration 058.
export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(100),
  parent_id: z.string().uuid('Invalid parent category ID').optional(),
  /** Audience for the new custom row. Defaults to inheriting the parent's
   *  audience (or 'grooming' for top-level customs). Allows a freelancer to
   *  add an event-side category (e.g., "Sangeet Choreography Pairing") that
   *  the event-manager picker will surface. */
  audience: audienceEnum.optional(),
});

/** GET /catalog/categories[?audience=...] query schema. Filter narrows the
 *  visible roots to a single audience or 'both' (which matches everything
 *  surfaced to both vendor + event UIs). Omitted = return all visible. */
export const categoryQuerySchema = z.object({
  audience: audienceEnum.optional(),
});

export const categoryIdParam = z.object({
  id: z.string().uuid('Invalid category ID'),
});

