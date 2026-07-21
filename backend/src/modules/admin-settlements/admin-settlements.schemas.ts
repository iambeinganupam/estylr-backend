// ─────────────────────────────────────────────────────────────────────────────
// Admin Settlements — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const settlementListSchema = z.object({
  vendor_id:   z.string().uuid().optional(),
  vendor_type: z.enum(['freelancer', 'salon_location']).optional(),
  from:        isoDate.optional(),
  to:          isoDate.optional(),
  search:      z.string().trim().max(120).optional(),
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type SettlementListQuery = z.infer<typeof settlementListSchema>;

export const settlementSummarySchema = z.object({
  from: isoDate.optional(),
  to:   isoDate.optional(),
});
export type SettlementSummaryQuery = z.infer<typeof settlementSummarySchema>;
