// ─────────────────────────────────────────────────────────────────────────────
// Admin Audit Log — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminAuditLogService } from './admin-audit-log.service';
import { auditIdParam, auditListSchema } from './admin-audit-log.schemas';

export const adminAuditLogController = Router();
adminAuditLogController.use(authMiddleware);
adminAuditLogController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminAuditLogController.get(
  '/',
  validateQuery(auditListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof auditListSchema>;
    const result = await adminAuditLogService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminAuditLogController.get(
  '/:id',
  validateParams(auditIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminAuditLogService.get(String(req.params.id));
    success(res, row);
  }),
);
