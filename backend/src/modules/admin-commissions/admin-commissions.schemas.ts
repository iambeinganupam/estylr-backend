// ─────────────────────────────────────────────────────────────────────────────
// Admin Commissions — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const ledgerStatusFilter = z.enum(['collected', 'pending', 'waived', 'all']);

export const commissionLedgerSchema = z.object({
  vendor_id:   z.string().uuid().optional(),
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
  from:        isoDate.optional(),
  to:          isoDate.optional(),
  status:      ledgerStatusFilter.optional().default('all'),
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type CommissionLedgerQuery = z.infer<typeof commissionLedgerSchema>;

export const commissionSummarySchema = z.object({
  from: isoDate.optional(),
  to:   isoDate.optional(),
});
export type CommissionSummaryQuery = z.infer<typeof commissionSummarySchema>;

export const commissionIdParam = z.object({
  id: z.string().uuid(),
});

export const commissionWaiveSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CommissionWaiveBody = z.infer<typeof commissionWaiveSchema>;

// Manual ledger adjustment — admin can credit (negative amount) or debit
// (positive amount) a vendor's outstanding balance directly. Use cases:
// goodwill credit, correction after a billing dispute, etc.
export const commissionAdjustSchema = z.object({
  vendor_type: z.enum(['freelancer', 'salon_location']),
  vendor_id:   z.string().uuid(),
  /**
   * Adjustment amount in INR (rupees). Positive = debit (vendor owes more);
   * negative = credit (reduce what vendor owes). Must be non-zero.
   */
  amount:   z.number().refine((n) => n !== 0, { message: 'amount must be non-zero' }),
  reason:   z.string().trim().min(3).max(500),
});
export type CommissionAdjustBody = z.infer<typeof commissionAdjustSchema>;
