// ─────────────────────────────────────────────────────────────────────────────
// Customer Finance — Controller
// ─────────────────────────────────────────────────────────────────────────────
// Mounted at the API_PREFIX root; routes use absolute /me/* paths to
// stay consistent with the addresses module's style.
// All routes are customer-only, JWT-authenticated.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { customerFinanceService } from './customer-finance.service';
import {
  refundsListQuery,
  transactionIdParam,
  transactionsListQuery,
} from './customer-finance.schemas';

export const customerFinanceController: RouterType = Router();
// IMPORTANT: scope these middlewares to /me so the router doesn't intercept
// every unrelated /api/v1/* path that falls through to it. The controller is
// mounted at the bare API_PREFIX (no /finance prefix), and an unscoped
// router.use(roleGuard(CUSTOMER)) rejected super_admin requests for paths
// like /admin/subscription-plans (which should 404, not 403) because they
// happened to fall through to this router after all sibling mounts missed.
customerFinanceController.use('/me', authMiddleware);
customerFinanceController.use('/me', roleGuard(USER_ROLE.CUSTOMER));

customerFinanceController.get(
  '/me/transactions',
  validateQuery(transactionsListQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof transactionsListQuery>;
    const result = await customerFinanceService.listTransactions(req.auth!.userId, q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

customerFinanceController.get(
  '/me/transactions/:id',
  validateParams(transactionIdParam),
  asyncHandler(async (req, res) => {
    const row = await customerFinanceService.getTransaction(
      req.auth!.userId,
      String(req.params.id),
    );
    success(res, row);
  }),
);

customerFinanceController.get(
  '/me/refunds',
  validateQuery(refundsListQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof refundsListQuery>;
    const result = await customerFinanceService.listRefunds(req.auth!.userId, q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);
