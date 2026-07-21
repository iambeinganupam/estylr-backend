// ─────────────────────────────────────────────────────────────────────────────
// Admin Settings — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const settingsUpdateSchema = z.object({
  default_commission:      z.number().min(0).max(100).optional(),
  gst_rate:                z.number().min(0).max(100).optional(),
  currency:                z.string().trim().length(3).optional(),
  payout_cycle:            z.enum(['daily', 'weekly', 'biweekly', 'monthly']).optional(),
  kyc_required_docs:       z.array(z.string().trim().min(1).max(64)).max(10).optional(),
  kyc_auto_expiry_days:    z.number().int().min(0).max(3650).optional(),
  default_category_id:     z.string().uuid().nullable().optional(),
  max_services_per_vendor: z.number().int().min(1).max(1000).optional(),
  feature_flags:           z.record(z.boolean()).optional(),
  platform_name:           z.string().trim().min(1).max(120).optional(),
  timezone:                z.string().trim().min(1).max(64).optional(),
  reason:                  z.string().trim().max(500).optional(),
}).refine(
  (v) => Object.keys(v).some((k) => k !== 'reason' && v[k as keyof typeof v] !== undefined),
  { message: 'At least one writable field is required' },
);
export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>;
