// ─────────────────────────────────────────────────────────────────────────────
// Admin Settlements — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminSettlementsService } from './admin-settlements.service';
import {
  settlementListSchema,
  settlementSummarySchema,
} from './admin-settlements.schemas';

export const adminSettlementsController = Router();
adminSettlementsController.use(authMiddleware);
adminSettlementsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminSettlementsController.get(
  '/',
  validateQuery(settlementListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof settlementListSchema>;
    const result = await adminSettlementsService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminSettlementsController.get(
  '/summary',
  validateQuery(settlementSummarySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof settlementSummarySchema>;
    const data = await adminSettlementsService.summary(q);
    success(res, data);
  }),
);

adminSettlementsController.get(
  '/:id',
  validateParams(z.object({ id: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const row = await adminSettlementsService.get(String(req.params.id));
    success(res, row);
  }),
);
