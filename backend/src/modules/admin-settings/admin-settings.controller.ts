// ─────────────────────────────────────────────────────────────────────────────
// Admin Settings — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminSettingsService } from './admin-settings.service';
import { settingsUpdateSchema } from './admin-settings.schemas';

export const adminSettingsController = Router();
adminSettingsController.use(authMiddleware);
adminSettingsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminSettingsController.get(
  '/',
  asyncHandler(async (_req, res) => {
    const row = await adminSettingsService.get();
    success(res, row);
  }),
);

adminSettingsController.patch(
  '/',
  validateBody(settingsUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminSettingsService.update(req.body, req);
    success(res, row);
  }),
);
