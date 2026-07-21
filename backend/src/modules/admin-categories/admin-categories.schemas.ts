// ─────────────────────────────────────────────────────────────────────────────
// Admin Categories — Schemas
//
// Zod validators for the super_admin taxonomy management surface. Mirrors the
// service_categories table closely; clients edit the global tree (rows with
// vendor_id IS NULL) and never need to know about vendor-scoped customs from
// this endpoint.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { CATEGORY_AUDIENCE } from '../../lib/constants';

export const audienceEnum = z.enum([
  CATEGORY_AUDIENCE.GROOMING,
  CATEGORY_AUDIENCE.WEDDING,
  CATEGORY_AUDIENCE.BOTH,
]);

/** Lowercase URL slugs, hyphen-separated. 2–80 chars. Same shape used by
 *  customer-facing routing — locked here so admin edits can't break URLs. */
const slugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters')
  .max(80, 'Slug must be at most 80 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens');

/** Lucide-react icon names live in the `icon` column (replacing the legacy
 *  `icon_url` for new rows). Accept anything that looks like an identifier;
 *  the frontend validates against its available icon set. */
const iconSchema = z.string().trim().min(1).max(40);

const aliasesSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(10, 'Up to 10 search aliases per category');

const queryBool = z
  .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
  .optional();

// ── GET /admin/categories ────────────────────────────────────────────────────
export const categoryListQuerySchema = z.object({
  audience: audienceEnum.optional(),
  parent_id: z.string().uuid().nullable().optional(),
  include_inactive: queryBool,
  search: z.string().trim().min(1).max(100).optional(),
});
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;

// ── GET /admin/categories/tree ───────────────────────────────────────────────
// Same query shape; included separately so the controller can validate it.
export const categoryTreeQuerySchema = categoryListQuerySchema;

// ── POST /admin/categories ───────────────────────────────────────────────────
export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(100),
  /** Slug auto-derives from name when omitted (mirrors the catalog repo). */
  slug: slugSchema.optional(),
  parent_id: z.string().uuid('Invalid parent category ID').nullable().optional(),
  audience: audienceEnum.optional(),
  description: z.string().trim().max(500).optional(),
  icon: iconSchema.optional(),
  aliases: aliasesSchema.optional(),
  sort_order: z.number().int().min(0).max(99999).optional(),
  is_active: z.boolean().optional(),
});
export type CategoryCreateBody = z.infer<typeof categoryCreateSchema>;

// ── PATCH /admin/categories/:id ──────────────────────────────────────────────
// Every field optional, but at least one must be present (no-op PATCH is a
// caller error — flag it loudly instead of silently no-op'ing).
export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    slug: slugSchema.optional(),
    parent_id: z.string().uuid().nullable().optional(),
    audience: audienceEnum.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    icon: iconSchema.nullable().optional(),
    aliases: aliasesSchema.optional(),
    sort_order: z.number().int().min(0).max(99999).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one writable field must be provided.',
  });
export type CategoryUpdateBody = z.infer<typeof categoryUpdateSchema>;

// ── POST /admin/categories/reorder ───────────────────────────────────────────
// Reorder is bulk-only; the caller sends the desired final order of sibling
// IDs (under a single parent) and the service spreads sort_order in 10-step
// increments. Avoids the per-row PATCH thrash a drag-reorder UI would cause.
export const categoryReorderSchema = z.object({
  parent_id: z.string().uuid().nullable(),
  ids: z.array(z.string().uuid()).min(1).max(200),
});
export type CategoryReorderBody = z.infer<typeof categoryReorderSchema>;

export const categoryIdParam = z.object({
  id: z.string().uuid('Invalid category ID'),
});
