// ─────────────────────────────────────────────────────────────────────────────
// Admin Bookings — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const APPT_STATUS = z.enum([
  'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'all',
]);

export const PAYMENT_METHOD = z.enum(['upi', 'card', 'cash', 'online', 'all']);

export const bookingListSchema = z.object({
  status:         APPT_STATUS.optional().default('all'),
  vendor_id:      z.string().uuid().optional(),
  vendor_type:    z.enum(['freelancer', 'salon_location']).optional(),
  customer_id:    z.string().uuid().optional(),
  city:           z.string().trim().max(100).optional(),
  from:           isoDate.optional(),
  to:             isoDate.optional(),
  payment_method: PAYMENT_METHOD.optional().default('all'),
  search:         z.string().trim().max(120).optional(),
  cursor:         z.string().optional(),
  limit:          z.coerce.number().int().min(1).max(100).default(25),
});
export type BookingListQuery = z.infer<typeof bookingListSchema>;

export const bookingIdParam = z.object({
  id: z.string().uuid(),
});

export const bookingUpdateSchema = z.object({
  status:              z.enum(['confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']).optional(),
  completion_note:     z.string().trim().max(2000).nullable().optional(),
  cancellation_reason: z.string().trim().max(500).nullable().optional(),
  reason:              z.string().trim().max(500).optional(),
}).refine(
  (v) => v.status !== undefined || v.completion_note !== undefined || v.cancellation_reason !== undefined,
  { message: 'At least one writable field is required' },
);
export type BookingUpdateBody = z.infer<typeof bookingUpdateSchema>;
