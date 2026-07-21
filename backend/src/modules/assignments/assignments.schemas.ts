// ─────────────────────────────────────────────────────────────────────────────
// Assignments Module — Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────
// Inputs only. Output shapes are inferred from the repository's row types.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { ASSIGNMENT_ACTION, ASSIGNMENT_STATUS } from '../../lib/constants';

// ── Path / Query Params ──────────────────────────────────────────────────────

export const assignmentIdParam = z.object({
  id: z.string().uuid('Invalid assignment id'),
});

const STATUS_VALUES = Object.values(ASSIGNMENT_STATUS) as [
  typeof ASSIGNMENT_STATUS[keyof typeof ASSIGNMENT_STATUS],
  ...Array<typeof ASSIGNMENT_STATUS[keyof typeof ASSIGNMENT_STATUS]>,
];

export const listAssignmentsQuerySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ── Body ─────────────────────────────────────────────────────────────────────

export const createAssignmentSchema = z
  .object({
    salon_location_id: z.string().uuid(),
    freelancer_id: z.string().uuid(),
    service_category: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
    start_time: z.string().datetime(),
    end_time: z.string().datetime(),
    proposed_amount: z.number().nonnegative().max(999999.99).default(0),
  })
  .strict()
  .refine(
    (v) => new Date(v.end_time) > new Date(v.start_time),
    { message: 'end_time must be after start_time', path: ['end_time'] },
  );

const ACTION_VALUES = Object.values(ASSIGNMENT_ACTION) as [
  typeof ASSIGNMENT_ACTION[keyof typeof ASSIGNMENT_ACTION],
  ...Array<typeof ASSIGNMENT_ACTION[keyof typeof ASSIGNMENT_ACTION]>,
];

export const assignmentActionSchema = z
  .object({
    action: z.enum(ACTION_VALUES),
    reason: z.string().max(500).optional(),
  })
  .strict();
