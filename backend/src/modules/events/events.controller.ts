// ─────────────────────────────────────────────────────────────────────────────
// Events Module — Controller (EVT-01 through EVT-10)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware, optionalAuth } from '../../middleware/auth.middleware';
import { validateBody, validateParams } from '../../middleware/validate.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { success, created, noContent } from '../../lib/response';
import { eventsService } from './events.service';
import {
  createEventSchema, addAttendeeSchema,
  updateAttendeeSchema, eventIdParam, attendeeIdParam,
} from './events.schemas';

export const eventsController = Router();

// ── EVT-01: Create Event ──
eventsController.post(
  '/',
  authMiddleware,
  validateBody(createEventSchema),
  asyncHandler(async (req, res) => {
    const event = await eventsService.createEvent(
      req.auth!.userId, req.body.event_name, req.body.event_date, req.body.notes,
    );
    created(res, event);
  }),
);

// ── EVT-02: List My Events ──
eventsController.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const events = await eventsService.listMyEvents(req.auth!.userId);
    success(res, events);
  }),
);

// ── EVT-08: Get Event Templates [PUBLIC] ──
// Registered BEFORE /:id so the literal "templates" path matches before the
// dynamic id segment. Express picks the first matching route, so a route
// declared after /:id with a literal segment is unreachable.
eventsController.get(
  '/templates',
  optionalAuth,
  asyncHandler(async (_req, res) => {
    const templates = await eventsService.getTemplates();
    success(res, templates);
  }),
);

// ── EVT-03: Get Event Detail ──
eventsController.get(
  '/:id',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => {
    const event = await eventsService.getEventDetail(
      String(req.params.id),
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    success(res, event);
  }),
);

// ── EVT-04: Add Attendee + Service ──
eventsController.post(
  '/:id/attendees',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(eventIdParam),
  validateBody(addAttendeeSchema),
  asyncHandler(async (req, res) => {
    const attendee = await eventsService.addAttendee(
      String(req.params.id), req.body.guest_name, req.body.service_id,
      req.body.preferred_vendor_id, req.body.notes,
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    created(res, attendee);
  }),
);

// ── EVT-05: Update Attendee ──
eventsController.put(
  '/:eventId/attendees/:attendeeId',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(attendeeIdParam),
  validateBody(updateAttendeeSchema),
  asyncHandler(async (req, res) => {
    const attendee = await eventsService.updateAttendee(
      String(req.params.eventId), String(req.params.attendeeId), req.body,
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    success(res, attendee);
  }),
);

// ── EVT-06: Remove Attendee ──
eventsController.delete(
  '/:eventId/attendees/:attendeeId',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(attendeeIdParam),
  asyncHandler(async (req, res) => {
    await eventsService.removeAttendee(
      String(req.params.eventId), String(req.params.attendeeId),
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    noContent(res);
  }),
);

// ── EVT-07: Checkout Event (Batch Book) ── placeholder for full impl with booking engine
eventsController.post(
  '/:id/checkout',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => {
    // This will integrate with BookingService to create intents per attendee
    // For now, returns the budget summary as confirmation
    const budget = await eventsService.getBudgetSummary(
      String(req.params.id),
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    success(res, { message: 'Checkout initiated', ...budget });
  }),
);

// ── EVT-09: Event Budget Summary ──
eventsController.get(
  '/:id/budget',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => {
    const budget = await eventsService.getBudgetSummary(
      String(req.params.id),
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    );
    success(res, budget);
  }),
);

// ── EVT-10: Event Calendar View ──
eventsController.get(
  '/:id/calendar',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => {
    // Returns event detail with attendee slot assignments
    const detail = await eventsService.getEventDetail(
      String(req.params.id),
      { userId: req.auth!.userId, role: req.auth!.role, tenantId: req.auth!.tenantId },
    ) as Record<string, unknown>;
    success(res, { event_date: detail.event_date, attendees: detail.attendees });
  }),
);
