// ─────────────────────────────────────────────────────────────────────────────
// Booking Module — Schemas + Repository + Service + Controller
// ─────────────────────────────────────────────────────────────────────────────
// Implements the 2-phase booking flow:
//   1. Intent: draft → lock → convert (or expire)
//   2. Appointment: pending → confirmed → in_progress → completed (or cancel/no_show)
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { TX_METHOD } from '../../lib/constants';

// ── Booking Intent ──
export const createIntentSchema = z.object({
  vendor_type: z.enum(['freelancer', 'salon_location']),
  vendor_id: z.string().uuid(),
  service_id: z.string().uuid(),
  staff_member_id: z.string().uuid().optional(),
  slot_start: z.string().datetime('Must be ISO datetime'),
  slot_end: z.string().datetime('Must be ISO datetime'),
}).refine((d) => new Date(d.slot_end) > new Date(d.slot_start), {
  message: 'slot_end must be after slot_start',
  path: ['slot_end'],
});

export const lockIntentSchema = z.object({
  customer_name: z.string().min(1).max(100),
  customer_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  notes: z.string().max(500).optional(),
});

// ── Convert Intent → Appointment ──
// Confirm-step payload. Both fields optional so older clients (and the
// pre-existing appointment_action transition tests) keep working; the
// customer portal's confirm page always sends `payment_method` and, for
// home-delivery services, `customer_address_id`.
export const convertIntentSchema = z.object({
  payment_method: z.enum([
    TX_METHOD.UPI,
    TX_METHOD.CARD,
    TX_METHOD.CASH,
    TX_METHOD.ONLINE,
  ]).optional(),
  customer_address_id: z.string().uuid('Invalid address id').optional(),
});
export type ConvertIntentBody = z.infer<typeof convertIntentSchema>;

// ── Appointment ──
export const appointmentActionSchema = z.object({
  action: z.enum(['confirm', 'cancel', 'verify-otp', 'start', 'complete', 'no-show']),
  otp_code: z.string().length(6).optional(),
  cancellation_reason: z.string().max(500).optional(),
});

export const rescheduleSchema = z.object({
  new_slot_start: z.string().datetime(),
  new_slot_end: z.string().datetime(),
}).refine((d) => new Date(d.new_slot_end) > new Date(d.new_slot_start), {
  message: 'new_slot_end must be after new_slot_start',
  path: ['new_slot_end'],
});

export const appointmentListSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']).optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const intentIdParam = z.object({
  intentId: z.string().uuid('Invalid intent ID'),
});

export const appointmentIdParam = z.object({
  id: z.string().uuid('Invalid appointment ID'),
});

// ── Walk-in Appointment (business_admin direct creation) ──
export const walkInSchema = z.object({
  service_ids: z.array(z.string().uuid()).min(1, 'At least one service is required').max(10),
  customer_name: z.string().min(1).max(100),
  customer_phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164 format (e.g. +919876543210)')
    .optional(),
  slot_start: z.string().datetime('Must be ISO datetime'),
  slot_end: z.string().datetime('Must be ISO datetime'),
  staff_member_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  booking_type: z.enum(['walkin', 'kshuri']).default('walkin'),
}).refine((d) => new Date(d.slot_end) > new Date(d.slot_start), {
  message: 'slot_end must be after slot_start',
  path: ['slot_end'],
});
