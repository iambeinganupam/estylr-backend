// ─────────────────────────────────────────────────────────────────────────────
// Admin Customers — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });
const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
).optional();

export const customerListSchema = z.object({
  is_active:    queryBool,
  has_bookings: queryBool,
  joined_from:  isoDate.optional(),
  joined_to:    isoDate.optional(),
  city:         z.string().trim().max(100).optional(),
  search:       z.string().trim().max(120).optional(),
  cursor:       z.string().optional(),
  limit:        z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerListQuery = z.infer<typeof customerListSchema>;

export const customerIdParam = z.object({
  id: z.string().uuid(),
});

export const customerStatusSchema = z.object({
  is_active: z.boolean(),
  reason:    z.string().trim().min(3).max(500).optional(),
});
export type CustomerStatusBody = z.infer<typeof customerStatusSchema>;

export const customerUpdateSchema = z.object({
  email:              z.string().email().max(255).nullable().optional(),
  phone_number:       z.string().trim().max(20).nullable().optional(),
  first_name:         z.string().trim().max(100).nullable().optional(),
  last_name:          z.string().trim().max(100).nullable().optional(),
  gender_preference:  z.enum(['male', 'female', 'unisex', 'no_preference']).nullable().optional(),
  marketing_opt_in:   z.boolean().optional(),
  reason:             z.string().trim().max(500).optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'reason' && v[k as keyof typeof v] !== undefined),
  { message: 'At least one writable field is required' },
);
export type CustomerUpdateBody = z.infer<typeof customerUpdateSchema>;
