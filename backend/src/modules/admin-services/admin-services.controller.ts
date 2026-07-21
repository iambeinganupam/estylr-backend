// ─────────────────────────────────────────────────────────────────────────────
// Admin Services — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { created, noContent, paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminServicesService } from './admin-services.service';
import {
  serviceCreateSchema,
  serviceIdParam,
  serviceListSchema,
  serviceUpdateSchema,
} from './admin-services.schemas';

export const adminServicesController = Router();
adminServicesController.use(authMiddleware);
adminServicesController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminServicesController.get(
  '/',
  validateQuery(serviceListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof serviceListSchema>;
    const result = await adminServicesService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminServicesController.get(
  '/:id',
  validateParams(serviceIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminServicesService.get(String(req.params.id));
    success(res, row);
  }),
);

adminServicesController.post(
  '/',
  validateBody(serviceCreateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminServicesService.create(req.body, req);
    created(res, row);
  }),
);

adminServicesController.patch(
  '/:id',
  validateParams(serviceIdParam),
  validateBody(serviceUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminServicesService.update(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

adminServicesController.delete(
  '/:id',
  validateParams(serviceIdParam),
  asyncHandler(async (req, res) => {
    await adminServicesService.softDelete(String(req.params.id), req);
    noContent(res);
  }),
);
