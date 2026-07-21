// ─────────────────────────────────────────────────────────────────────────────
// Admin Bookings — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminBookingsService } from './admin-bookings.service';
import {
  bookingIdParam,
  bookingListSchema,
  bookingUpdateSchema,
} from './admin-bookings.schemas';

export const adminBookingsController = Router();
adminBookingsController.use(authMiddleware);
adminBookingsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminBookingsController.get(
  '/',
  validateQuery(bookingListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof bookingListSchema>;
    const result = await adminBookingsService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminBookingsController.get(
  '/:id',
  validateParams(bookingIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminBookingsService.get(String(req.params.id));
    success(res, row);
  }),
);

adminBookingsController.patch(
  '/:id',
  validateParams(bookingIdParam),
  validateBody(bookingUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminBookingsService.update(String(req.params.id), req.body, req);
    success(res, row);
  }),
);
