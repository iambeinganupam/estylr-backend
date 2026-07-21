// ─────────────────────────────────────────────────────────────────────────────
// Admin Plans — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const planIdParam = z.object({ id: z.string().uuid() });

export const planCreateSchema = z.object({
  code:                        z.string().trim().min(2).max(64).regex(/^[a-z0-9_]+$/i),
  display_name:                z.string().trim().min(1).max(120),
  tagline:                     z.string().trim().max(500).nullable().optional(),
  monthly_fee_inr:             z.number().min(0),
  commission_percent:          z.number().min(0).max(100),
  included_bookings_per_month: z.number().int().min(0).nullable().optional(),
  features:                    z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  is_active:                   z.boolean().default(true),
  is_default:                  z.boolean().default(false),
  is_publicly_selectable:      z.boolean().default(false),
  sort_order:                  z.number().int().min(0).default(0),
});
export type PlanCreateBody = z.infer<typeof planCreateSchema>;

export const planUpdateSchema = z.object({
  display_name:                z.string().trim().min(1).max(120).optional(),
  tagline:                     z.string().trim().max(500).nullable().optional(),
  monthly_fee_inr:             z.number().min(0).optional(),
  commission_percent:          z.number().min(0).max(100).optional(),
  included_bookings_per_month: z.number().int().min(0).nullable().optional(),
  features:                    z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  is_active:                   z.boolean().optional(),
  is_default:                  z.boolean().optional(),
  is_publicly_selectable:      z.boolean().optional(),
  sort_order:                  z.number().int().min(0).optional(),
  reason:                      z.string().trim().max(500).optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'reason' && v[k as keyof typeof v] !== undefined),
  { message: 'At least one writable field is required' },
);
export type PlanUpdateBody = z.infer<typeof planUpdateSchema>;
