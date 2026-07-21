// ─────────────────────────────────────────────────────────────────────────────
// Availability Module — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware, optionalAuth } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { availabilityService } from './availability.service';
import { VENDOR_TYPE, type ShiftType } from '../../lib/constants';
import {
  slotsQuerySchema,
  updateWorkingHoursSchema,
  createBlockSchema,
  blockIdParam,
  createShiftSchema,
  batchShiftSchema,
  updateShiftSchema,
  shiftIdParam,
  calendarQuerySchema,
} from './availability.schemas';

interface ShiftPayload {
  staff_member_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  type?: ShiftType;
}

function toServiceShift(s: ShiftPayload) {
  return {
    staffMemberId: s.staff_member_id,
    shiftDate: s.shift_date,
    startTime: s.start_time,
    endTime: s.end_time,
    type: s.type,
  };
}

export const availabilityController = Router();

function resolveVendor(req: import('express').Request) {
  if (req.auth!.role === 'freelancer') {
    return { vendorType: VENDOR_TYPE.FREELANCER, vendorId: req.tenant!.freelancerProfileId! };
  }
  return { vendorType: VENDOR_TYPE.SALON_LOCATION, vendorId: req.tenant!.locationId || req.tenant!.businessId! };
}

// ── AVAIL-01: Get Available Slots (PUBLIC) ──
availabilityController.get(
  '/slots',
  optionalAuth,
  validateQuery(slotsQuerySchema),
  asyncHandler(async (req, res) => {
    // `service_ids` is transformed to a string[] by the schema's pipe;
    // `service_id` stays as a single string when supplied.
    const q = req.query as unknown as {
      vendor_type: string;
      vendor_id: string;
      service_id?: string;
      service_ids?: string[];
      staff_id?: string;
      date: string;
    };
    const slots = await availabilityService.getAvailableSlots({
      vendorType: q.vendor_type,
      vendorId: q.vendor_id,
      serviceId: q.service_id,
      serviceIds: q.service_ids,
      staffId: q.staff_id,
      date: q.date,
    });
    success(res, slots);
  }),
);

// ── AVAIL-02a: Get Working Hours ──
availabilityController.get(
  '/working-hours',
  authMiddleware,
  roleGuard('freelancer', 'business_admin', 'staff'),
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const hours = await availabilityService.getWorkingHours(vendorType, vendorId);
    success(res, hours);
  }),
);

// ── AVAIL-02b: Update Working Hours ──
availabilityController.put(
  '/working-hours',
  authMiddleware,
  roleGuard('freelancer', 'business_admin'),
  tenantMiddleware,
  validateBody(updateWorkingHoursSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const hours = await availabilityService.updateWorkingHours(vendorType, vendorId, req.body.hours);
    success(res, hours);
  }),
);

// ── AVAIL-03: Create Time Block ──
availabilityController.post(
  '/blocks',
  authMiddleware,
  roleGuard('freelancer', 'business_admin', 'staff'),
  tenantMiddleware,
  validateBody(createBlockSchema),
  asyncHandler(async (req, res) => {
    const block = await availabilityService.createTimeBlock({
      startTime: req.body.start_time,
      endTime: req.body.end_time,
      reason: req.body.reason,
      targetType: req.body.target_type,
      targetId: req.body.target_id,
      createdBy: req.auth!.userId,
    });
    created(res, block);
  }),
);

// ── AVAIL-04: Delete Time Block ──
availabilityController.delete(
  '/blocks/:id',
  authMiddleware,
  roleGuard('freelancer', 'business_admin', 'staff'),
  tenantMiddleware,
  validateParams(blockIdParam),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    await availabilityService.deleteTimeBlock(String(req.params.id), vendorType, vendorId);
    noContent(res);
  }),
);

// ── AVAIL-05a: Create a single shift ──
availabilityController.post(
  '/shifts',
  authMiddleware,
  roleGuard('freelancer', 'business_admin'),
  tenantMiddleware,
  validateBody(createShiftSchema),
  asyncHandler(async (req, res) => {
    resolveVendor(req); // assert tenant context (throws if missing)
    const shift = await availabilityService.createShift(toServiceShift(req.body as ShiftPayload));
    created(res, shift);
  }),
);

// ── AVAIL-05b: Batch-create shifts ──
availabilityController.post(
  '/shifts/batch',
  authMiddleware,
  roleGuard('freelancer', 'business_admin'),
  tenantMiddleware,
  validateBody(batchShiftSchema),
  asyncHandler(async (req, res) => {
    resolveVendor(req);
    const result = await availabilityService.batchCreateShifts(
      (req.body.shifts as ShiftPayload[]).map(toServiceShift),
    );
    created(res, result);
  }),
);

// ── AVAIL-06: Update Shift ──
availabilityController.patch(
  '/shifts/:id',
  authMiddleware,
  roleGuard('freelancer', 'business_admin'),
  tenantMiddleware,
  validateParams(shiftIdParam),
  validateBody(updateShiftSchema),
  asyncHandler(async (req, res) => {
    const shift = await availabilityService.updateShift(String(req.params.id), req.body);
    success(res, shift);
  }),
);

// ── AVAIL-07: Calendar View ──
availabilityController.get(
  '/calendar',
  authMiddleware,
  roleGuard('freelancer', 'business_admin', 'staff'),
  tenantMiddleware,
  validateQuery(calendarQuerySchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const q = req.query as { start_date: string; end_date: string };
    const events = await availabilityService.getCalendar(vendorType, vendorId, q.start_date, q.end_date);
    success(res, events);
  }),
);
