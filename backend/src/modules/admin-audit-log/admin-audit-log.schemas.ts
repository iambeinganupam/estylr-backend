// ─────────────────────────────────────────────────────────────────────────────
// Admin Audit Log — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const auditListSchema = z.object({
  admin_id:    z.string().uuid().optional(),
  action:      z.string().trim().max(64).optional(),
  entity_type: z.string().trim().max(32).optional(),
  entity_id:   z.string().uuid().optional(),
  from:        isoDate.optional(),
  to:          isoDate.optional(),
  search:      z.string().trim().max(120).optional(),
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditListQuery = z.infer<typeof auditListSchema>;

export const auditIdParam = z.object({
  id: z.string().uuid(),
});
