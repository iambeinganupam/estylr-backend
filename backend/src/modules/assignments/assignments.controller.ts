// ─────────────────────────────────────────────────────────────────────────────
// Assignments Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
// Routes mounted at /api/v1/assignments. Both salon (business_admin) and
// freelancer roles share the resource; list/get/action endpoints auto-scope
// by the caller's role via tenant context.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { TenantMismatchError } from '../../lib/errors';
import { assignmentsService } from './assignments.service';
import {
  createAssignmentSchema,
  assignmentActionSchema,
  assignmentIdParam,
  listAssignmentsQuerySchema,
} from './assignments.schemas';

export const assignmentsController = Router();

assignmentsController.use(authMiddleware);
assignmentsController.use(tenantMiddleware);
assignmentsController.use(
  roleGuard(USER_ROLE.BUSINESS_ADMIN, USER_ROLE.FREELANCER),
);

// ── Create (salon only) ──────────────────────────────────────────────────────
assignmentsController.post(
  '/',
  roleGuard(USER_ROLE.BUSINESS_ADMIN),
  validateBody(createAssignmentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createAssignmentSchema>;
    const businessId = req.tenant?.businessId;
    if (!businessId) throw new TenantMismatchError();

    const row = await assignmentsService.create({
      businessId,
      salonLocationId: body.salon_location_id,
      freelancerId: body.freelancer_id,
      createdByUserId: req.auth!.userId,
      serviceCategory: body.service_category ?? null,
      notes: body.notes ?? null,
      startTime: body.start_time,
      endTime: body.end_time,
      proposedAmount: body.proposed_amount,
    });
    created(res, row);
  }),
);

// ── List (auto-scoped by role) ───────────────────────────────────────────────
assignmentsController.get(
  '/',
  validateQuery(listAssignmentsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listAssignmentsQuerySchema>;
    let rows;
    if (req.auth!.role === USER_ROLE.BUSINESS_ADMIN) {
      const businessId = req.tenant?.businessId;
      if (!businessId) throw new TenantMismatchError();
      rows = await assignmentsService.listForBusiness(businessId, q.status, q.limit);
    } else {
      const profileId = req.tenant?.freelancerProfileId;
      if (!profileId) throw new TenantMismatchError();
      rows = await assignmentsService.listForFreelancer(profileId, q.status, q.limit);
    }
    success(res, rows);
  }),
);

// ── Get one (auto-scoped by role) ────────────────────────────────────────────
assignmentsController.get(
  '/:id',
  validateParams(assignmentIdParam),
  asyncHandler(async (req, res) => {
    const row = await assignmentsService.getForRole(String(req.params.id), {
      role: req.auth!.role,
      businessId: req.tenant?.businessId,
      freelancerProfileId: req.tenant?.freelancerProfileId,
    });
    success(res, row);
  }),
);

// ── Action (state transition; role authorisation in state machine) ───────────
assignmentsController.post(
  '/:id/action',
  validateParams(assignmentIdParam),
  validateBody(assignmentActionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof assignmentActionSchema>;
    const row = await assignmentsService.applyAction(
      String(req.params.id),
      body.action,
      {
        userId: req.auth!.userId,
        role: req.auth!.role,
        businessId: req.tenant?.businessId,
        freelancerProfileId: req.tenant?.freelancerProfileId,
      },
      body.reason ?? null,
    );
    success(res, row);
  }),
);

