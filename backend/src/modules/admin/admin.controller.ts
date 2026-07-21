import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { adminService } from './admin.service';
import * as kycService from '../kyc/kyc.service';
import { kycDecisionSchema, kycIdParam } from '../kyc/kyc.schemas';
import {
  userStatusUpdateSchema,
  usersListSchema,
  userIdParam,
} from './admin.schemas';
// Category CRUD (ADM-06 … ADM-09b) was relocated to the dedicated
// `admin-categories` module (4-file pattern). The promote endpoint moved
// with it. This module no longer owns /categories.

export const adminController = Router();

adminController.use(authMiddleware);
adminController.use(roleGuard('super_admin'));

// ── ADM-01: Get Pending KYC — proxy to kyc module ──
adminController.get(
  '/kyc/pending',
  asyncHandler(async (_req, res) => {
    const pending = await kycService.listPending();
    success(res, pending);
  }),
);

// ── ADM-02: Approve or Reject KYC — proxy to kyc module ──
// Keeps the existing path stable for current clients while delegating logic
// to the new kyc module (which writes the audit log + kycDecisionsTotal metric).
adminController.patch(
  '/kyc/:id',
  validateParams(kycIdParam),
  validateBody(kycDecisionSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { action, reason } = req.body as { action: 'approve' | 'reject'; reason?: string };
    const reviewerId = req.auth!.userId;

    let result;
    if (action === 'approve') {
      result = await kycService.approve(String(id), reviewerId, req);
    } else {
      result = await kycService.reject(String(id), reviewerId, reason!, req);
    }
    success(res, result);
  }),
);

// ── ADM-03: List Users ──
adminController.get(
  '/users',
  validateQuery(usersListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof usersListSchema>;
    const result = await adminService.listUsers({
      role: q.role,
      is_active: q.is_active,
      page: q.page,
      limit: q.limit,
    });
    success(res, result.users, {
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  }),
);

// ── ADM-04: Update User Status ──
adminController.patch(
  '/users/:id/status',
  validateParams(userIdParam),
  validateBody(userStatusUpdateSchema),
  asyncHandler(async (req, res) => {
    const result = await adminService.updateUserStatus(
      String(req.params.id),
      req.body.status,
      req,
    );
    success(res, result);
  }),
);

// ── ADM-05: Platform Stats ──
adminController.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = await adminService.getPlatformStats();
    success(res, stats);
  }),
);

// ── ADM-12: KYC approve alias — proxy to kyc module ──
adminController.post(
  '/kyc/:id/approve',
  validateParams(kycIdParam),
  asyncHandler(async (req, res) => {
    const result = await kycService.approve(String(req.params.id), req.auth!.userId, req);
    success(res, result);
  }),
);

// ── ADM-13: KYC reject alias — proxy to kyc module ──
adminController.post(
  '/kyc/:id/reject',
  validateParams(kycIdParam),
  asyncHandler(async (req, res) => {
    const reason: string = req.body?.reason ?? '';
    const result = await kycService.reject(String(req.params.id), req.auth!.userId, reason, req);
    success(res, result);
  }),
);

// ADM-14 (/settings) and ADM-15 (/subscription-plans) stubs removed.
// Real routes are mounted at /api/v1/admin/settings (adminSettingsController)
// and /api/v1/admin/plans (adminPlansController) in app.ts — those take
// precedence over this catch-all controller.
