// ─────────────────────────────────────────────────────────────────────────────
// Admin Refunds — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { created, paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminRefundsService } from './admin-refunds.service';
import {
  refundCompleteSchema,
  refundCreateSchema,
  refundDecisionSchema,
  refundIdParam,
  refundListSchema,
} from './admin-refunds.schemas';

export const adminRefundsController = Router();
adminRefundsController.use(authMiddleware);
adminRefundsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminRefundsController.get(
  '/',
  validateQuery(refundListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof refundListSchema>;
    const result = await adminRefundsService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminRefundsController.get(
  '/:id',
  validateParams(refundIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminRefundsService.get(String(req.params.id));
    success(res, row);
  }),
);

adminRefundsController.patch(
  '/:id',
  validateParams(refundIdParam),
  validateBody(refundDecisionSchema),
  asyncHandler(async (req, res) => {
    const row = await adminRefundsService.resolve(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

adminRefundsController.post(
  '/',
  validateBody(refundCreateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminRefundsService.createAdminInitiated(req.body, req);
    created(res, row);
  }),
);

adminRefundsController.patch(
  '/:id/complete',
  validateParams(refundIdParam),
  validateBody(refundCompleteSchema),
  asyncHandler(async (req, res) => {
    const row = await adminRefundsService.markCompleted(String(req.params.id), req.body, req);
    success(res, row);
  }),
);
