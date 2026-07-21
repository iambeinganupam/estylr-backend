// ─────────────────────────────────────────────────────────────────────────────
// Locations module — Controller
// ─────────────────────────────────────────────────────────────────────────────
// Routes mounted under `/api/v1/admin/locations` (super_admin only). Used by
// the admin dashboard's <CityAtom> filter combobox.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateQuery } from '../../middleware/validate.middleware';
import { success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { locationsService } from './locations.service';
import { citiesQuerySchema } from './locations.schemas';

export const locationsController = Router();
locationsController.use(authMiddleware);
locationsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

locationsController.get(
  '/cities',
  validateQuery(citiesQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof citiesQuerySchema>;
    const cities = await locationsService.listCities({ search: q.search, limit: q.limit });
    success(res, cities);
  }),
);
