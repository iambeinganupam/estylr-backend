// ─────────────────────────────────────────────────────────────────────────────
// Admin Staff — Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
).optional();

// Shape-only validation. Role codes live in staff_roles (migration 091) and
// change without a deploy, so this can no longer be a fixed z.enum() — a
// hardcoded list here would drift from the table exactly like the old
// pre-091 list did. 'all' is a query sentinel, not a real role code. An
// unrecognized role value simply matches zero rows in the WHERE clause — no
// need for the service layer to reject it, unlike the update path below.
export const STAFF_ROLE_FILTER = z.string().trim().min(1).max(50);

export const staffListSchema = z.object({
  employer_id: z.string().uuid().optional(),
  role:        STAFF_ROLE_FILTER.optional().default('all'),
  is_active:   queryBool,
  city:        z.string().trim().max(100).optional(),
  search:      z.string().trim().max(120).optional(),
  cursor:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type StaffListQuery = z.infer<typeof staffListSchema>;

export const staffIdParam = z.object({
  id: z.string().uuid(),
});

export const staffUpdateSchema = z.object({
  // Shape-only here too — admin-staff.service.ts calls
  // staffService.assertValidRoleCode() before writing, checked against the
  // live staff_roles table (cached), so an unknown/inactive role is rejected
  // with a clear error before it ever reaches the database.
  role:                  z.string().trim().min(1).max(50).optional(),
  is_active:             z.boolean().optional(),
  commission_percentage: z.number().min(0).max(100).optional(),
  reason:                z.string().trim().max(500).optional(),
}).refine(
  (v) => v.role !== undefined || v.is_active !== undefined || v.commission_percentage !== undefined,
  { message: 'At least one writable field is required' },
);
export type StaffUpdateBody = z.infer<typeof staffUpdateSchema>;
