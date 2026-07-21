// ─────────────────────────────────────────────────────────────────────────────
// Admin Media — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
).optional();

export const MEDIA_TYPE = z.enum(['portfolio', 'before_after', 'profile', 'cover', 'all']);

export const mediaListSchema = z.object({
  vendor_id:   z.string().uuid().optional(),
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
  media_type:  MEDIA_TYPE.optional().default('all'),
  is_public:   queryBool,
  is_featured: queryBool,
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type MediaListQuery = z.infer<typeof mediaListSchema>;

export const mediaIdParam = z.object({ id: z.string().uuid() });

export const mediaDeleteSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type MediaDeleteBody = z.infer<typeof mediaDeleteSchema>;

export const mediaUpdateSchema = z.object({
  is_public:   z.boolean().optional(),
  is_featured: z.boolean().optional(),
  caption:     z.string().trim().max(200).nullable().optional(),
  reason:      z.string().trim().max(500).optional(),
}).refine(
  (v) => v.is_public !== undefined || v.is_featured !== undefined || v.caption !== undefined,
  { message: 'At least one writable field is required' },
);
export type MediaUpdateBody = z.infer<typeof mediaUpdateSchema>;
