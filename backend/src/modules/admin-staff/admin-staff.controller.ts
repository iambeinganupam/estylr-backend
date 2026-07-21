// ─────────────────────────────────────────────────────────────────────────────
// Admin Staff — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminStaffService } from './admin-staff.service';
import { staffIdParam, staffListSchema, staffUpdateSchema } from './admin-staff.schemas';

export const adminStaffController = Router();
adminStaffController.use(authMiddleware);
adminStaffController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminStaffController.get(
  '/',
  validateQuery(staffListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof staffListSchema>;
    const result = await adminStaffService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminStaffController.get(
  '/:id',
  validateParams(staffIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminStaffService.get(String(req.params.id));
    success(res, row);
  }),
);

adminStaffController.patch(
  '/:id',
  validateParams(staffIdParam),
  validateBody(staffUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminStaffService.update(String(req.params.id), req.body, req);
    success(res, row);
  }),
);
