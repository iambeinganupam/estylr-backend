// ─────────────────────────────────────────────────────────────────────────────
// Admin Services — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { SERVICE_LOCATION } from '../../lib/constants';

const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
).optional();

export const GENDER_TARGET = z.enum(['male', 'female', 'unisex', 'no_preference']);
export const SERVICE_LOCATION_ENUM = z.enum([
  SERVICE_LOCATION.ONSITE,
  SERVICE_LOCATION.HOME,
  SERVICE_LOCATION.BOTH,
]);

export const serviceListSchema = z.object({
  vendor_id:   z.string().uuid().optional(),
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
  category_id: z.string().uuid().optional(),
  is_active:   queryBool,
  search:      z.string().trim().max(120).optional(),
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type ServiceListQuery = z.infer<typeof serviceListSchema>;

export const serviceIdParam = z.object({ id: z.string().uuid() });

export const serviceCreateSchema = z.object({
  vendor_type:      z.enum(['freelancer', 'salon_location']),
  vendor_id:        z.string().uuid(),
  category_id:      z.string().uuid().nullable().optional(),
  name:             z.string().trim().min(1).max(200),
  description:      z.string().trim().max(2000).nullable().optional(),
  price:            z.number().min(0),
  duration_minutes: z.number().int().min(1).max(24 * 60),
  gender_target:    GENDER_TARGET.default('unisex'),
  is_active:        z.boolean().default(true),
  inclusions:       z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  service_location: SERVICE_LOCATION_ENUM.default(SERVICE_LOCATION.ONSITE),
});
export type ServiceCreateBody = z.infer<typeof serviceCreateSchema>;

export const serviceUpdateSchema = z.object({
  category_id:      z.string().uuid().nullable().optional(),
  name:             z.string().trim().min(1).max(200).optional(),
  description:      z.string().trim().max(2000).nullable().optional(),
  price:            z.number().min(0).optional(),
  duration_minutes: z.number().int().min(1).max(24 * 60).optional(),
  gender_target:    GENDER_TARGET.optional(),
  is_active:        z.boolean().optional(),
  inclusions:       z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  service_location: SERVICE_LOCATION_ENUM.optional(),
  reason:           z.string().trim().max(500).optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'reason' && v[k as keyof typeof v] !== undefined),
  { message: 'At least one writable field is required' },
);
export type ServiceUpdateBody = z.infer<typeof serviceUpdateSchema>;
