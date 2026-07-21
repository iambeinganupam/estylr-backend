// ─────────────────────────────────────────────────────────────────────────────
// Admin Reviews — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });
const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
).optional();

export const reviewListSchema = z.object({
  vendor_id:   z.string().uuid().optional(),
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
  customer_id: z.string().uuid().optional(),
  is_visible:  queryBool,
  rating_min:  z.coerce.number().int().min(1).max(5).optional(),
  rating_max:  z.coerce.number().int().min(1).max(5).optional(),
  from:        isoDate.optional(),
  to:          isoDate.optional(),
  search:      z.string().trim().max(120).optional(),
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type ReviewListQuery = z.infer<typeof reviewListSchema>;

export const reviewIdParam = z.object({ id: z.string().uuid() });

export const reviewModerateSchema = z.object({
  action: z.enum(['hide', 'unhide']),
  reason: z.string().trim().min(3).max(500),
});
export type ReviewModerateBody = z.infer<typeof reviewModerateSchema>;
