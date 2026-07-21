// ─────────────────────────────────────────────────────────────────────────────
// Finance Module — Schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const txListSchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // API surface uses 'settled' as the public alias for the DB's 'completed'.
  // The repository translates back when building the WHERE clause.
  status: z.enum(['pending', 'settled', 'completed', 'failed', 'refunded']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const createPaymentSchema = z.object({
  appointment_id: z.string().uuid(),
  // Server derives amount from appointment.total_amount if omitted (preferred for COD).
  amount: z.number().min(0.01).max(999999.99).optional(),
  currency: z.string().length(3).default('INR'),
  payment_method: z.enum(['upi', 'card', 'cash', 'online']).default('cash'),
});

export const processPayoutSchema = z.object({
  staff_ids: z.array(z.string().uuid()).min(1),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const bankAccountSchema = z.object({
  bank_name: z.string().min(1).max(100),
  account_number: z.string().min(5).max(30),
  ifsc_code: z.string().min(4).max(15),
  account_holder_name: z.string().min(1).max(100),
  is_primary: z.boolean().default(true),
});

export const exportSchema = z.object({
  format: z.enum(['csv', 'pdf']),
  type: z.enum(['transactions', 'tax_summary', 'payout_history']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const payoutPeriodSchema = z.object({
  period: z.enum(['this_week', 'last_week', 'this_month']).default('this_month'),
});

export const txIdParam = z.object({ id: z.string().uuid() });

// ── Vendor-collected payments (Phase 1 manual UPI) ──────────────────────────

export const upiQrRequestSchema = z.object({
  appointment_id: z.string().uuid(),
  /** Optional override; server defaults to appointment.total_amount. */
  amount: z.number().min(0.01).max(999999.99).optional(),
});

export const recordSettlementSchema = z.object({
  /** Positive number; the service negates it before writing the ledger row. */
  amount: z.number().min(0.01).max(9999999.99),
  /** Bank/UPI reference for traceability (e.g. NEFT UTR or UPI txn id). */
  external_ref: z.string().min(1).max(255).optional(),
  notes: z.string().max(500).optional(),
  /** Super admin posts on behalf of a specific vendor. Omit to settle the
   *  caller's own dues (vendor self-service). */
  vendor_id: z.string().uuid().optional(),
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
}).refine(
  (b) => (b.vendor_id == null) === (b.vendor_type == null),
  { message: 'vendor_id and vendor_type must be provided together', path: ['vendor_id'] },
);
