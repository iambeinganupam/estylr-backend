// ─────────────────────────────────────────────────────────────────────────────
// Staff Module — Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// ── STAFF-01: Get Schedule (accepts either week_start or date) ──
export const staffScheduleQuerySchema = z.object({
  week_start: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
  date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
});

// ── STAFF-02: Get Earnings ──
export const staffEarningsQuerySchema = z.object({
  from_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
  to_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
});

// ── STAFF-03: Update Appointment Status ──
export const updateAppointmentStatusSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'no_show', 'cancelled']),
});

// ── STAFF-04 & STAFF-05: Appointment ID Param ──
export const appointmentIdParam = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID'),
});

// ── STAFF-06: Attendance Query ──
export const staffAttendanceQuerySchema = z.object({
  from_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
  to_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ── STAFF-11: Update Staff Profile ──
export const updateStaffProfileSchema = z.object({
  full_name: z.string().min(1).max(150).optional(),
  email:     z.string().email().optional(),
  address:   z.string().max(500).optional(),
  avatar_url: z.string().url().max(500).optional(),
});

// ── STAFF-12: Create / Upload Document ──
export const createDocumentSchema = z.object({
  document_type: z.enum(['aadhaar', 'pan', 'trade_license', 'bank_passbook', 'other']),
  document_number: z.string().max(100).optional(),
  file_url: z.string().url().max(500).optional(),
});

// ── STAFF-13: Upsert Bank Details ──
export const upsertBankDetailsSchema = z.object({
  bank_name:       z.string().min(1).max(150),
  account_holder:  z.string().min(1).max(150),
  account_number:  z.string().min(5).max(30),
  ifsc_code:       z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
  payment_mode:    z.enum(['bank_transfer', 'upi']).optional(),
});

// ── STAFF-14: Reviews Query ──
export const staffReviewsQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ── STF-15: My Bookings — cursor-paginated list with filters ──
// Backs the staff /appointments page's "past bookings" view. The existing
// STF-01 /me/schedule returns a week; this endpoint streams the full
// historical timeline filtered by status / date / search.
const isoDateTime = z.string().datetime({ offset: true });
export const myBookingsListSchema = z.object({
  status:   z.enum(['confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'all']).optional().default('all'),
  from:     isoDateTime.optional(),
  to:       isoDateTime.optional(),
  search:   z.string().trim().max(120).optional(),
  cursor:   z.string().optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(25),
});
export type MyBookingsListQuery = z.infer<typeof myBookingsListSchema>;
