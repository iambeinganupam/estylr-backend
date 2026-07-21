// ─────────────────────────────────────────────────────────────────────────────
// Booking Module — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { bookingRateLimiter } from '../../middleware/rate-limit.middleware';
import { success, created } from '../../lib/response';
import { withIdempotency } from '../../lib/idempotency';
import { bookingService } from './booking.service';
import { staffRepository } from '../staff/staff.repository';
import { VENDOR_TYPE } from '../../lib/constants';
import {
  createIntentSchema, lockIntentSchema, intentIdParam,
  convertIntentSchema,
  appointmentActionSchema, appointmentIdParam,
  appointmentListSchema, rescheduleSchema, walkInSchema,
} from './booking.schemas';

export const bookingController: RouterType = Router();
bookingController.use(authMiddleware);

// ── BOOK-01: Create Booking Intent ──
bookingController.post(
  '/intents',
  roleGuard('customer'),
  bookingRateLimiter,
  validateBody(createIntentSchema),
  asyncHandler(async (req, res) => {
    const idemHeader = req.headers['idempotency-key'];
    const idemKey = typeof idemHeader === 'string' && idemHeader.length > 0 ? idemHeader : null;

    const run = () => bookingService.createIntent(req.auth!.userId, {
      vendorType: req.body.vendor_type,
      vendorId: req.body.vendor_id,
      serviceId: req.body.service_id,
      staffMemberId: req.body.staff_member_id,
      slotStart: req.body.slot_start,
      slotEnd: req.body.slot_end,
    });

    const intent = idemKey
      ? await withIdempotency(`intent:${req.auth!.userId}:${idemKey}`, 10 * 60 * 1000, run)
      : await run();

    created(res, intent);
  }),
);

// ── BOOK-02: Lock Intent ──
bookingController.patch(
  '/intents/:intentId/lock',
  roleGuard('customer'),
  validateParams(intentIdParam),
  validateBody(lockIntentSchema),
  asyncHandler(async (req, res) => {
    const locked = await bookingService.lockIntent(
      String(req.params.intentId), req.auth!.userId, req.body,
    );
    success(res, locked);
  }),
);

// ── BOOK-03: Convert Intent to Appointment ──
// Body is optional (older clients send {}). New portal sends payment_method
// and — for home-delivery services — customer_address_id. Both are
// validated and persisted on the appointment.
bookingController.post(
  '/intents/:intentId/convert',
  roleGuard('customer'),
  validateParams(intentIdParam),
  validateBody(convertIntentSchema),
  asyncHandler(async (req, res) => {
    const appointment = await bookingService.convertIntent(
      String(req.params.intentId),
      req.auth!.userId,
      {
        paymentMethod: req.body.payment_method,
        customerAddressId: req.body.customer_address_id,
      },
    );
    created(res, appointment);
  }),
);

// ── BOOK-03b: Release a locked intent (early slot release) ──
// Idempotent: 200 with { released: false } when there is nothing to release
// (already converted, expired, cancelled, or owned by another customer).
bookingController.post(
  '/intents/:intentId/release',
  roleGuard('customer'),
  validateParams(intentIdParam),
  asyncHandler(async (req, res) => {
    const result = await bookingService.releaseIntent(
      req.auth!.userId, String(req.params.intentId),
    );
    success(res, result);
  }),
);

// ── BOOK-03c: Fetch own intent (for confirm-step rehydration / timer anchor) ──
// Returns the intent if it still belongs to the caller and is in a non-final
// state; returns `null` (200) when not found / not owned / already
// converted, so the portal can route the user back to the slot picker
// without leaking ownership info via 404.
bookingController.get(
  '/intents/:intentId',
  roleGuard('customer'),
  validateParams(intentIdParam),
  asyncHandler(async (req, res) => {
    const intent = await bookingService.getOwnIntent(
      req.auth!.userId, String(req.params.intentId),
    );
    success(res, intent);
  }),
);

// ── BOOK-04: Get Appointment ──
bookingController.get(
  '/appointments/:id',
  validateParams(appointmentIdParam),
  asyncHandler(async (req, res) => {
    const appointment = await bookingService.getAppointment(String(req.params.id), {
      userId: req.auth!.userId,
      role: req.auth!.role,
      tenantId: req.auth!.tenantId,
    });
    success(res, appointment);
  }),
);

// ── BOOK-05: Appointment Action (confirm/cancel/verify-otp/complete/no-show) ──
bookingController.post(
  '/appointments/:id/action',
  validateParams(appointmentIdParam),
  validateBody(appointmentActionSchema),
  asyncHandler(async (req, res) => {
    const extra: Record<string, unknown> = {};
    if (req.body.cancellation_reason) extra.cancellation_reason = req.body.cancellation_reason;
    if (req.body.otp_code) extra.otp_code = req.body.otp_code;

    const appointment = await bookingService.transitionAppointment(
      String(req.params.id),
      req.body.action,
      req.auth!.role,
      extra,
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    success(res, appointment);
  }),
);

// ── BOOK-06: List Appointments (vendor view) ──
bookingController.get(
  '/appointments',
  tenantMiddleware,
  validateQuery(appointmentListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined> & { limit: number };
    let vendorType: string | undefined;
    let vendorId: string | undefined;
    let customerId: string | undefined;
    let staffMemberId: string | undefined;

    if (req.auth!.role === 'customer') {
      customerId = req.auth!.userId;
    } else if (req.auth!.role === 'freelancer') {
      vendorType = VENDOR_TYPE.FREELANCER;
      vendorId = req.tenant?.freelancerProfileId;
    } else if (req.auth!.role === 'staff') {
      // Staff see only the appointments assigned to them within their salon.
      vendorType = VENDOR_TYPE.SALON_LOCATION;
      vendorId = req.tenant?.locationId || req.tenant?.businessId;
      const staff = await staffRepository.findStaffMemberByUserId(req.auth!.userId);
      staffMemberId = staff?.id;
    } else {
      vendorType = VENDOR_TYPE.SALON_LOCATION;
      vendorId = req.tenant?.locationId || req.tenant?.businessId;
    }

    const rows = await bookingService.listAppointments({
      vendorType, vendorId, customerId, staffMemberId,
      status: q.status, fromDate: q.from_date, toDate: q.to_date,
      limit: q.limit, cursor: q.cursor,
    });
    success(res, rows);
  }),
);

// ── BOOK-07b: Walk-in Appointment (business_admin direct creation) ──
bookingController.post(
  '/walk-in',
  roleGuard('business_admin'),
  tenantMiddleware,
  validateBody(walkInSchema),
  asyncHandler(async (req, res) => {
    const vendorId = req.tenant?.locationId || req.tenant?.businessId;
    if (!vendorId) {
      throw new (await import('../../lib/errors')).ResourceNotFoundError('Vendor context');
    }
    const appointment = await bookingService.createWalkIn({
      vendorType: VENDOR_TYPE.SALON_LOCATION,
      vendorId,
      serviceIds: req.body.service_ids,
      customerName: req.body.customer_name,
      customerPhone: req.body.customer_phone,
      slotStart: req.body.slot_start,
      slotEnd: req.body.slot_end,
      staffMemberId: req.body.staff_member_id,
      bookingType: req.body.booking_type,
      notes: req.body.notes,
    });
    created(res, appointment);
  }),
);

// ── BOOK-07: Reschedule Appointment ──
bookingController.patch(
  '/appointments/:id/reschedule',
  roleGuard('customer', 'freelancer', 'business_admin', 'staff', 'super_admin'),
  validateParams(appointmentIdParam),
  validateBody(rescheduleSchema),
  asyncHandler(async (req, res) => {
    const appointment = await bookingService.rescheduleAppointment(
      String(req.params.id),
      req.body.new_slot_start,
      req.body.new_slot_end,
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    success(res, appointment);
  }),
);
