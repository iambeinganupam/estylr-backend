// ─────────────────────────────────────────────────────────────────────────────
// Staff Module — Controller (STF-01 through STF-14)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created } from '../../lib/response';
import { staffService } from './staff.service';
import {
  staffScheduleQuerySchema,
  staffEarningsQuerySchema,
  staffAttendanceQuerySchema,
  updateAppointmentStatusSchema,
  appointmentIdParam,
  updateStaffProfileSchema,
  createDocumentSchema,
  upsertBankDetailsSchema,
  staffReviewsQuerySchema,
  myBookingsListSchema,
} from './staff.schemas';
import { paginated } from '../../lib/response';

export const staffController = Router();

staffController.use(authMiddleware);
staffController.use(roleGuard('staff'));

// ── STF-01: Get My Schedule ──────────────────────────────────────────────────
staffController.get(
  '/me/schedule',
  validateQuery(staffScheduleQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof staffScheduleQuerySchema>;
    const schedule = await staffService.getSchedule(req.auth!.userId, q.week_start, q.date);
    success(res, schedule);
  }),
);

// ── STF-02: Get My Earnings ──────────────────────────────────────────────────
staffController.get(
  '/me/earnings',
  validateQuery(staffEarningsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof staffEarningsQuerySchema>;
    const earnings = await staffService.getEarnings(req.auth!.userId, q.from_date, q.to_date);
    success(res, earnings);
  }),
);

// ── STF-03: Update Appointment Status ───────────────────────────────────────
staffController.patch(
  '/me/appointments/:appointmentId/status',
  validateParams(appointmentIdParam),
  validateBody(updateAppointmentStatusSchema),
  asyncHandler(async (req, res) => {
    const updated = await staffService.updateAppointmentStatus(
      req.auth!.userId,
      String(req.params.appointmentId),
      req.body.status,
    );
    success(res, updated);
  }),
);

// ── STF-04: Clock In ─────────────────────────────────────────────────────────
staffController.post(
  '/me/clock-in',
  asyncHandler(async (req, res) => {
    const record = await staffService.clockIn(req.auth!.userId);
    success(res, record);
  }),
);

// ── STF-05: Clock Out ────────────────────────────────────────────────────────
staffController.post(
  '/me/clock-out',
  asyncHandler(async (req, res) => {
    const record = await staffService.clockOut(req.auth!.userId);
    success(res, record);
  }),
);

// ── STF-06: Clock Status ─────────────────────────────────────────────────────
staffController.get(
  '/me/clock-status',
  asyncHandler(async (req, res) => {
    const data = await staffService.getClockStatus(req.auth!.userId);
    success(res, data);
  }),
);

// ── STF-07: Attendance History ───────────────────────────────────────────────
staffController.get(
  '/me/attendance',
  validateQuery(staffAttendanceQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof staffAttendanceQuerySchema>;
    const data = await staffService.getAttendanceHistory(req.auth!.userId, q);
    success(res, data);
  }),
);

// ── STF-08: Weekly Chart ─────────────────────────────────────────────────────
staffController.get(
  '/me/weekly-chart',
  asyncHandler(async (req, res) => {
    const data = await staffService.getWeeklyChart(req.auth!.userId);
    success(res, data);
  }),
);

// ── STF-09: Targets ──────────────────────────────────────────────────────────
staffController.get(
  '/me/targets',
  asyncHandler(async (req, res) => {
    const data = await staffService.getTargets(req.auth!.userId);
    success(res, data);
  }),
);

// ── STF-10: Commission History ───────────────────────────────────────────────
staffController.get(
  '/me/commissions',
  asyncHandler(async (req, res) => {
    const data = await staffService.getCommissionHistory(req.auth!.userId);
    success(res, data);
  }),
);

// ── STF-11: Get My Profile ───────────────────────────────────────────────────
staffController.get(
  '/me/profile',
  asyncHandler(async (req, res) => {
    const profile = await staffService.getProfile(req.auth!.userId);
    success(res, profile);
  }),
);

// ── STF-11b: Update My Profile ───────────────────────────────────────────────
staffController.put(
  '/me/profile',
  validateBody(updateStaffProfileSchema),
  asyncHandler(async (req, res) => {
    const patch = req.body as z.infer<typeof updateStaffProfileSchema>;
    const profile = await staffService.updateProfile(req.auth!.userId, patch);
    success(res, profile);
  }),
);

// ── STF-12: Get My Documents ─────────────────────────────────────────────────
staffController.get(
  '/me/documents',
  asyncHandler(async (req, res) => {
    const docs = await staffService.getDocuments(req.auth!.userId);
    success(res, docs);
  }),
);

// ── STF-12b: Upload / Update a Document ─────────────────────────────────────
staffController.post(
  '/me/documents',
  validateBody(createDocumentSchema),
  asyncHandler(async (req, res) => {
    const doc = req.body as z.infer<typeof createDocumentSchema>;
    const result = await staffService.uploadDocument(req.auth!.userId, doc);
    created(res, result);
  }),
);

// ── STF-13: Get Bank Details ─────────────────────────────────────────────────
staffController.get(
  '/me/bank-details',
  asyncHandler(async (req, res) => {
    const details = await staffService.getBankDetails(req.auth!.userId);
    success(res, details);
  }),
);

// ── STF-13b: Upsert Bank Details ─────────────────────────────────────────────
staffController.put(
  '/me/bank-details',
  validateBody(upsertBankDetailsSchema),
  asyncHandler(async (req, res) => {
    const details = req.body as z.infer<typeof upsertBankDetailsSchema>;
    const result = await staffService.updateBankDetails(req.auth!.userId, details);
    success(res, result);
  }),
);

// ── STF-14: Get My Reviews ───────────────────────────────────────────────────
staffController.get(
  '/me/reviews',
  validateQuery(staffReviewsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof staffReviewsQuerySchema>;
    const reviews = await staffService.getReviews(req.auth!.userId, q);
    success(res, reviews);
  }),
);

// ── STF-14b: Get Review Summary ──────────────────────────────────────────────
staffController.get(
  '/me/reviews/summary',
  asyncHandler(async (req, res) => {
    const summary = await staffService.getReviewSummary(req.auth!.userId);
    success(res, summary);
  }),
);

// ── STF-15: My Bookings (cursor-paginated historical list) ─────────────────
//   The /me/schedule endpoint returns a single week. This one streams the
//   full timeline filtered by status / date / search — used by the staff
//   /appointments page's "past bookings" view.
staffController.get(
  '/me/bookings',
  validateQuery(myBookingsListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof myBookingsListSchema>;
    const result = await staffService.listMyBookings(req.auth!.userId, q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

// ── STF-16: My Permissions ────────────────────────────────────────────────
//   Returns the staff member's role + a `can` capability map. Frontend uses
//   this at login to gate UI elements; future sub-roles (manager / sales /
//   receptionist) extend the map without touching consumer code.
staffController.get(
  '/me/permissions',
  asyncHandler(async (req, res) => {
    const data = await staffService.getMyPermissions(req.auth!.userId);
    success(res, data);
  }),
);
