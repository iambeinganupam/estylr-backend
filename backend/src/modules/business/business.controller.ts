// ─────────────────────────────────────────────────────────────────────────────
// Business Module — Controller (Routes)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams } from '../../middleware/validate.middleware';
import { success, created } from '../../lib/response';
import { businessService } from './business.service';
import {
  updateBusinessProfileSchema,
  updateLocationSchema,
  locationIdParam,
  inviteStaffSchema,
  updateStaffSchema,
  staffIdParam,
  updateBillingMethodSchema,
} from './business.schemas';

export const businessController = Router();

// All business routes require auth + business_admin role + tenant context
businessController.use(authMiddleware);
businessController.use(roleGuard('business_admin', 'staff'));
businessController.use(tenantMiddleware);

// ── BIZ-01: Get Business Profile ──
businessController.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const profile = await businessService.getProfile(req.tenant!.businessId!);
    success(res, profile);
  }),
);

// ── BIZ-02: Update Business Profile ──
businessController.put(
  '/profile',
  roleGuard('business_admin'),
  validateBody(updateBusinessProfileSchema),
  asyncHandler(async (req, res) => {
    const profile = await businessService.updateProfile(req.tenant!.businessId!, req.body);
    success(res, profile);
  }),
);

// ── BIZ-03a: List Locations ──
businessController.get(
  '/locations',
  asyncHandler(async (req, res) => {
    const locations = await businessService.listLocations(req.tenant!.businessId!);
    success(res, locations);
  }),
);

// ── BIZ-03: Get Location ──
businessController.get(
  '/locations/:locId',
  validateParams(locationIdParam),
  asyncHandler(async (req, res) => {
    const location = await businessService.getLocation(String(req.params.locId), req.tenant!.businessId!);
    success(res, location);
  }),
);

// ── BIZ-04: Update Location ──
businessController.put(
  '/locations/:locId',
  roleGuard('business_admin'),
  validateParams(locationIdParam),
  validateBody(updateLocationSchema),
  asyncHandler(async (req, res) => {
    const location = await businessService.updateLocation(
      String(req.params.locId),
      req.tenant!.businessId!,
      req.body,
    );
    success(res, location);
  }),
);

// ── BIZ-05: List Staff ──
businessController.get(
  '/staff',
  asyncHandler(async (req, res) => {
    const staff = await businessService.listStaff(req.tenant!.businessId!);
    success(res, staff);
  }),
);

// ── BIZ-06: Get Staff Member ──
businessController.get(
  '/staff/:staffId',
  validateParams(staffIdParam),
  asyncHandler(async (req, res) => {
    const member = await businessService.getStaffMember(String(req.params.staffId), req.tenant!.businessId!);
    success(res, member);
  }),
);

// ── BIZ-07: Invite Staff ──
businessController.post(
  '/staff/invite',
  roleGuard('business_admin'),
  validateBody(inviteStaffSchema),
  asyncHandler(async (req, res) => {
    const result = await businessService.inviteStaff({
      ...req.body,
      businessAccountId: req.tenant!.businessId!,
    });
    created(res, result);
  }),
);

// ── BIZ-08: Update Staff ──
businessController.put(
  '/staff/:staffId',
  roleGuard('business_admin'),
  validateParams(staffIdParam),
  validateBody(updateStaffSchema),
  asyncHandler(async (req, res) => {
    const member = await businessService.updateStaff(
      String(req.params.staffId),
      req.tenant!.businessId!,
      req.body,
    );
    success(res, member);
  }),
);

// ── BIZ-09: Get Staff Schedule ──
businessController.get(
  '/staff/:staffId/schedule',
  validateParams(staffIdParam),
  asyncHandler(async (req, res) => {
    const schedule = await businessService.getStaffSchedule(
      String(req.params.staffId),
      req.tenant!.businessId!,
    );
    success(res, schedule);
  }),
);

// ── BIZ-10: Get Staff Attendance ──
businessController.get(
  '/staff/:staffId/attendance',
  validateParams(staffIdParam),
  asyncHandler(async (req, res) => {
    const records = await businessService.getStaffAttendance(
      String(req.params.staffId),
      req.tenant!.businessId!,
    );
    success(res, records);
  }),
);

// ── BIZ-11: Get Staff Appointments ──
businessController.get(
  '/staff/:staffId/appointments',
  validateParams(staffIdParam),
  asyncHandler(async (req, res) => {
    const appointments = await businessService.getStaffAppointments(
      String(req.params.staffId),
      req.tenant!.businessId!,
    );
    success(res, appointments);
  }),
);

// ── BIZ-12: Get Staff Salary ──
businessController.get(
  '/staff/:staffId/salary',
  validateParams(staffIdParam),
  asyncHandler(async (req, res) => {
    const salary = await businessService.getStaffSalary(
      String(req.params.staffId),
      req.tenant!.businessId!,
    );
    success(res, salary);
  }),
);

// ── BIZ-13: Get Subscription ──
businessController.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    const sub = await businessService.getSubscription(req.tenant!.businessId!);
    success(res, sub);
  }),
);

// ── BIZ-14: Get Engagement Metrics (Profile Views, Favorites, Reviews) ──
// Pulls counters from the primary salon_location plus a live count from
// `public.favorites`. Used by the Manage Gallery stat tiles.
businessController.get(
  '/profile/engagement',
  asyncHandler(async (req, res) => {
    const metrics = await businessService.getEngagementMetrics(req.tenant!.businessId!);
    success(res, metrics);
  }),
);

// ── BIZ-11: Update Billing Method ──
businessController.patch(
  '/billing-method',
  roleGuard('business_admin'),
  validateBody(updateBillingMethodSchema),
  asyncHandler(async (req, res) => {
    const profile = await businessService.updateProfile(req.tenant!.businessId!, {
      billing_method: req.body.billing_method,
      payment_gateway: req.body.payment_gateway,
    });
    success(res, profile);
  }),
);
