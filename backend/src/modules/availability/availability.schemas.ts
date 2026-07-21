// ─────────────────────────────────────────────────────────────────────────────
// Availability Module — Schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { SHIFT_TYPE } from '../../lib/constants';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// ── AVAIL-01: Get Available Slots ──
//
//   `service_ids` — preferred for multi-service bookings (comma-separated
//      UUIDs). The server sums all service durations so the last bookable
//      slot still ends inside the day's working window.
//   `service_id`  — legacy single-service param, retained for the customer-
//      facing single-service flows that have not migrated yet.
//   At least one of the two MUST be present.
export const slotsQuerySchema = z.object({
  vendor_type: z.enum(['freelancer', 'salon_location']),
  vendor_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
  service_ids: z
    .string()
    .transform((s) => s.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(20))
    .optional(),
  staff_id: z.string().uuid().optional(),
  date: z.string().regex(dateRegex, 'Date must be YYYY-MM-DD'),
}).refine((q) => !!q.service_id || (Array.isArray(q.service_ids) && q.service_ids.length > 0), {
  message: 'Provide service_id or service_ids',
  path: ['service_id'],
});

// ── AVAIL-02b: Update Working Hours ──
export const updateWorkingHoursSchema = z.object({
  hours: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6), // 0=Sunday
    open_time: z.string().regex(timeRegex, 'Time must be HH:MM').nullable(),
    close_time: z.string().regex(timeRegex, 'Time must be HH:MM').nullable(),
    is_closed: z.boolean().default(false),
  }).refine(h => h.is_closed || (h.open_time !== null && h.close_time !== null), {
    message: 'open_time and close_time are required when is_closed is false',
  })).min(1).max(7),
});

// ── AVAIL-03: Create Time Block ──
export const createBlockSchema = z.object({
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  reason: z.string().max(255).optional(),
  target_type: z.enum(['freelancer', 'salon_location', 'staff_member']),
  target_id: z.string().uuid(),
}).refine((data) => new Date(data.end_time) > new Date(data.start_time), {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});

export const blockIdParam = z.object({
  id: z.string().uuid('Invalid block ID'),
});

// ── AVAIL-05: Shift Assignment ──
// `shiftType` is sourced from the SHIFT_TYPE constant (which mirrors the
// `shift_type` Postgres enum) so the API surface is the single source of
// truth for valid values — no translation layer.
const shiftType = z.enum([
  SHIFT_TYPE.REGULAR_SHIFT,
  SHIFT_TYPE.TIME_OFF,
  SHIFT_TYPE.LUNCH_BREAK,
]);

const shiftEntrySchema = z.object({
  staff_member_id: z.string().uuid(),
  shift_date: z.string().regex(dateRegex, 'Date must be YYYY-MM-DD'),
  start_time: z.string().regex(timeRegex, 'Time must be HH:MM'),
  end_time: z.string().regex(timeRegex, 'Time must be HH:MM'),
  type: shiftType.default(SHIFT_TYPE.REGULAR_SHIFT),
}).refine((s) => s.end_time > s.start_time, {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});

export const createShiftSchema = shiftEntrySchema;

export const batchShiftSchema = z.object({
  shifts: z.array(shiftEntrySchema).min(1).max(50),
});

// ── AVAIL-06: Update Shift ──
// Field names mirror the DB columns (`type`, `is_approved`) so what the
// client sends is what gets persisted — no silent rename in between.
// `.strict()` rejects unknown fields rather than dropping them, so clients
// catch typos at the boundary instead of seeing "200 OK, nothing changed".
export const updateShiftSchema = z.object({
  start_time: z.string().regex(timeRegex).optional(),
  end_time: z.string().regex(timeRegex).optional(),
  type: shiftType.optional(),
  is_approved: z.boolean().optional(),
}).strict().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one field must be provided' },
);

export const shiftIdParam = z.object({
  id: z.string().uuid('Invalid shift ID'),
});

// ── AVAIL-07: Calendar View ──
export const calendarQuerySchema = z.object({
  start_date: z.string().regex(dateRegex, 'Date must be YYYY-MM-DD'),
  end_date: z.string().regex(dateRegex, 'Date must be YYYY-MM-DD'),
});
