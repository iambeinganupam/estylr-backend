// ─────────────────────────────────────────────────────────────────────────────
// Admin Transactions — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const TX_STATUS = z.enum(['pending', 'completed', 'failed', 'refunded', 'all']);
export const PAYMENT_METHOD = z.enum(['upi', 'card', 'cash', 'online', 'all']);

export const transactionListSchema = z.object({
  status:         TX_STATUS.optional().default('all'),
  vendor_id:      z.string().uuid().optional(),
  payment_method: PAYMENT_METHOD.optional().default('all'),
  from:           isoDate.optional(),
  to:             isoDate.optional(),
  search:         z.string().trim().max(120).optional(),
  cursor:         z.string().optional(),
  limit:          z.coerce.number().int().min(1).max(100).default(25),
});
export type TransactionListQuery = z.infer<typeof transactionListSchema>;

export const transactionIdParam = z.object({ id: z.string().uuid() });

export const txMarkSettledSchema = z.object({
  external_ref: z.string().trim().min(1).max(255),
  reason:       z.string().trim().max(500).optional(),
});
export type TxMarkSettledBody = z.infer<typeof txMarkSettledSchema>;

export const txManualRefundSchema = z.object({
  /**
   * Refund amount in INR (rupees), e.g. 350.00 = ₹350.
   * Must be ≥ 0 with at most 2 decimal places. Matches transactions.amount unit.
   */
  refund_amount:  z.number().min(0).multipleOf(0.01),
  refund_reason:  z.string().trim().min(3).max(500),
});
export type TxManualRefundBody = z.infer<typeof txManualRefundSchema>;
