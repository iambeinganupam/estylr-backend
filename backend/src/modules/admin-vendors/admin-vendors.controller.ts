// ─────────────────────────────────────────────────────────────────────────────
// Admin Vendors — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { created, noContent, paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminVendorsService } from './admin-vendors.service';
import {
  vendorCreateSchema,
  vendorDeleteSchema,
  vendorIdParam,
  vendorListSchema,
  vendorUpdateSchema,
} from './admin-vendors.schemas';

export const adminVendorsController = Router();
adminVendorsController.use(authMiddleware);
adminVendorsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminVendorsController.get(
  '/',
  validateQuery(vendorListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof vendorListSchema>;
    const result = await adminVendorsService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminVendorsController.get(
  '/:id',
  validateParams(vendorIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminVendorsService.get(String(req.params.id));
    success(res, row);
  }),
);

adminVendorsController.patch(
  '/:id',
  validateParams(vendorIdParam),
  validateBody(vendorUpdateSchema),
  asyncHandler(async (req, res) => {
    const updated = await adminVendorsService.update(String(req.params.id), req.body, req);
    success(res, updated);
  }),
);

adminVendorsController.post(
  '/',
  validateBody(vendorCreateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminVendorsService.create(req.body, req);
    created(res, row);
  }),
);

adminVendorsController.delete(
  '/:id',
  validateParams(vendorIdParam),
  validateBody(vendorDeleteSchema),
  asyncHandler(async (req, res) => {
    await adminVendorsService.softDelete(String(req.params.id), req.body, req);
    noContent(res);
  }),
);
