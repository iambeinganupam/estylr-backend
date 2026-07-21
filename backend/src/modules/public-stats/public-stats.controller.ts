// ─────────────────────────────────────────────────────────────────────────────
// Public Stats Module — Controller (PUBLIC, no auth)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { success } from '../../lib/response';
import { publicStatsService } from './public-stats.service';

export const publicStatsController = Router();

publicStatsController.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = await publicStatsService.getStats();
    success(res, stats);
  }),
);
