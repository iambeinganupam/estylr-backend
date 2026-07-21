// ─────────────────────────────────────────────────────────────────────────────
// Admin Reviews — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminReviewsService } from './admin-reviews.service';
import {
  reviewIdParam,
  reviewListSchema,
  reviewModerateSchema,
} from './admin-reviews.schemas';

export const adminReviewsController = Router();
adminReviewsController.use(authMiddleware);
adminReviewsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminReviewsController.get(
  '/',
  validateQuery(reviewListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof reviewListSchema>;
    const result = await adminReviewsService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminReviewsController.get(
  '/:id',
  validateParams(reviewIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminReviewsService.get(String(req.params.id));
    success(res, row);
  }),
);

adminReviewsController.patch(
  '/:id/moderate',
  validateParams(reviewIdParam),
  validateBody(reviewModerateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminReviewsService.moderate(String(req.params.id), req.body, req);
    success(res, row);
  }),
);
