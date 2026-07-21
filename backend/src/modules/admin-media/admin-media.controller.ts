// ─────────────────────────────────────────────────────────────────────────────
// Admin Media — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { noContent, paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminMediaService } from './admin-media.service';
import {
  mediaDeleteSchema,
  mediaIdParam,
  mediaListSchema,
  mediaUpdateSchema,
} from './admin-media.schemas';

export const adminMediaController = Router();
adminMediaController.use(authMiddleware);
adminMediaController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminMediaController.get(
  '/',
  validateQuery(mediaListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof mediaListSchema>;
    const result = await adminMediaService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminMediaController.get(
  '/:id',
  validateParams(mediaIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminMediaService.get(String(req.params.id));
    success(res, row);
  }),
);

adminMediaController.patch(
  '/:id',
  validateParams(mediaIdParam),
  validateBody(mediaUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminMediaService.update(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

adminMediaController.delete(
  '/:id',
  validateParams(mediaIdParam),
  validateBody(mediaDeleteSchema),
  asyncHandler(async (req, res) => {
    await adminMediaService.delete(String(req.params.id), req.body, req);
    noContent(res);
  }),
);
