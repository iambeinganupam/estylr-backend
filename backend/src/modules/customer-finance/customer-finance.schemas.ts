// ─────────────────────────────────────────────────────────────────────────────
// Customer Finance — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────
// Read-only customer-side surface over the existing transactions table.
// Refunds are not a separate table — they are columns ON transactions
// (refund_amount, refund_reason, refunded_at; status='refunded' when complete).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const TX_STATUS_VALUES = ['pending', 'completed', 'failed', 'refunded'] as const;
export type TxStatus = (typeof TX_STATUS_VALUES)[number];

export const PAYMENT_METHOD_VALUES = ['upi', 'card', 'cash', 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];

export const transactionsListQuery = z.object({
  status: z.enum(TX_STATUS_VALUES).optional(),
  method: z.enum(PAYMENT_METHOD_VALUES).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TransactionsListQuery = z.infer<typeof transactionsListQuery>;

export const refundsListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type RefundsListQuery = z.infer<typeof refundsListQuery>;

export const transactionIdParam = z.object({
  id: z.string().uuid('Invalid transaction id'),
});

// ── Response shapes ──
// Exported as plain interfaces so the api-client can mirror them.
export interface CustomerTransaction {
  id: string;
  appointmentId: string | null;
  vendorName: string | null;
  amount: number;
  currency: string;
  method: PaymentMethod | null;
  status: TxStatus;
  subtotal: number | null;
  tax_amount: number | null;
  billNumber: string | null;
  refund: null | {
    amount: number;
    reason: string | null;
    refundedAt: string;
  };
  createdAt: string;
}
