// ─────────────────────────────────────────────────────────────────────────────
// Admin Customers — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminCustomersService } from './admin-customers.service';
import {
  customerIdParam,
  customerListSchema,
  customerStatusSchema,
  customerUpdateSchema,
} from './admin-customers.schemas';

export const adminCustomersController = Router();
adminCustomersController.use(authMiddleware);
adminCustomersController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminCustomersController.get(
  '/',
  validateQuery(customerListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof customerListSchema>;
    const result = await adminCustomersService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminCustomersController.get(
  '/:id',
  validateParams(customerIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminCustomersService.get(String(req.params.id));
    success(res, row);
  }),
);

adminCustomersController.patch(
  '/:id/status',
  validateParams(customerIdParam),
  validateBody(customerStatusSchema),
  asyncHandler(async (req, res) => {
    const row = await adminCustomersService.setStatus(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

adminCustomersController.patch(
  '/:id',
  validateParams(customerIdParam),
  validateBody(customerUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminCustomersService.update(String(req.params.id), req.body, req);
    success(res, row);
  }),
);
