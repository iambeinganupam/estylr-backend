// ─────────────────────────────────────────────────────────────────────────────
// Admin Commissions — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { created, paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminCommissionsService } from './admin-commissions.service';
import {
  commissionAdjustSchema,
  commissionIdParam,
  commissionLedgerSchema,
  commissionSummarySchema,
  commissionWaiveSchema,
} from './admin-commissions.schemas';

export const adminCommissionsController = Router();
adminCommissionsController.use(authMiddleware);
adminCommissionsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminCommissionsController.get(
  '/ledger',
  validateQuery(commissionLedgerSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof commissionLedgerSchema>;
    const result = await adminCommissionsService.ledger(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminCommissionsController.get(
  '/summary',
  validateQuery(commissionSummarySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof commissionSummarySchema>;
    const data = await adminCommissionsService.summary(q);
    success(res, data);
  }),
);

adminCommissionsController.patch(
  '/:id/waive',
  validateParams(commissionIdParam),
  validateBody(commissionWaiveSchema),
  asyncHandler(async (req, res) => {
    const row = await adminCommissionsService.waive(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

adminCommissionsController.post(
  '/adjustments',
  validateBody(commissionAdjustSchema),
  asyncHandler(async (req, res) => {
    const row = await adminCommissionsService.adjust(req.body, req);
    created(res, row);
  }),
);
