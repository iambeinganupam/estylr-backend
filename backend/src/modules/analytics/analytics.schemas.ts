// ─────────────────────────────────────────────────────────────────────────────
// Analytics Module — Schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const kpiSchema = z.object({
  range: z.enum(['today', 'week', '7d', 'month', '30d', 'quarter', '90d', 'custom']).default('30d'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const trendSchema = z.object({
  range: z.enum(['today', 'week', '7d', 'month', '30d', 'quarter', '90d']).default('30d'),
});

export const staffPerfSchema = z.object({
  location_id: z.string().uuid().optional(),
  range: z.enum(['today', 'week', '7d', 'month', '30d', 'quarter', '90d']).default('30d'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const customerSchema = z.object({
  range: z.enum(['today', 'week', '7d', 'month', '30d', 'quarter', '90d']).default('30d'),
});
