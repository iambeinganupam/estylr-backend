// ─────────────────────────────────────────────────────────────────────────────
// Admin Refunds — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const refundStatusFilter = z.enum(['pending', 'approved', 'rejected', 'completed', 'all']);

export const refundListSchema = z.object({
  status:    refundStatusFilter.optional().default('all'),
  vendor_id: z.string().uuid().optional(),
  from:      isoDate.optional(),
  to:        isoDate.optional(),
  search:    z.string().trim().max(120).optional(),
  cursor:    z.string().optional(),
  limit:     z.coerce.number().int().min(1).max(100).default(25),
});
export type RefundListQuery = z.infer<typeof refundListSchema>;

export const refundIdParam = z.object({
  id: z.string().uuid(),
});

export const refundDecisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note:   z.string().trim().min(3).max(500),
});
export type RefundDecisionBody = z.infer<typeof refundDecisionSchema>;

export const refundCreateSchema = z.object({
  appointment_id: z.string().uuid(),
  /**
   * Refund amount in INR (rupees), e.g. 500.00 = ₹500.
   * Must be a positive number with at most 2 decimal places.
   * Matches transactions.amount unit. The DB stores this as NUMERIC(10,2).
   * gateway_amount_paise (DB-computed) is used for provider API calls — never multiply here.
   */
  amount:  z.number().positive().multipleOf(0.01),
  reason:  z.string().trim().min(3).max(500),
});
export type RefundCreateBody = z.infer<typeof refundCreateSchema>;

export const refundCompleteSchema = z.object({
  provider_ref: z.string().trim().min(1).max(255),
  note:         z.string().trim().max(500).optional(),
});
export type RefundCompleteBody = z.infer<typeof refundCompleteSchema>;
