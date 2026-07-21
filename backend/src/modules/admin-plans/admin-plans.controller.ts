// ─────────────────────────────────────────────────────────────────────────────
// Admin Plans — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams } from '../../middleware/validate.middleware';
import { created, noContent, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminPlansService } from './admin-plans.service';
import { planCreateSchema, planIdParam, planUpdateSchema } from './admin-plans.schemas';

export const adminPlansController = Router();
adminPlansController.use(authMiddleware);
adminPlansController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminPlansController.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await adminPlansService.list();
    success(res, rows);
  }),
);

adminPlansController.get(
  '/:id',
  validateParams(planIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminPlansService.get(String(req.params.id));
    success(res, row);
  }),
);

adminPlansController.post(
  '/',
  validateBody(planCreateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminPlansService.create(req.body, req);
    created(res, row);
  }),
);

adminPlansController.patch(
  '/:id',
  validateParams(planIdParam),
  validateBody(planUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminPlansService.update(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

adminPlansController.delete(
  '/:id',
  validateParams(planIdParam),
  asyncHandler(async (req, res) => {
    await adminPlansService.softDelete(String(req.params.id), req);
    noContent(res);
  }),
);
