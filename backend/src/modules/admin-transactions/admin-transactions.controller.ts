// ─────────────────────────────────────────────────────────────────────────────
// Admin Transactions — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { paginated, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminTransactionsService } from './admin-transactions.service';
import {
  transactionIdParam,
  transactionListSchema,
  txManualRefundSchema,
  txMarkSettledSchema,
} from './admin-transactions.schemas';

export const adminTransactionsController = Router();
adminTransactionsController.use(authMiddleware);
adminTransactionsController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

adminTransactionsController.get(
  '/',
  validateQuery(transactionListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof transactionListSchema>;
    const result = await adminTransactionsService.list(q);
    paginated(res, result.data, { next_cursor: result.next_cursor, has_more: result.has_more });
  }),
);

adminTransactionsController.get(
  '/:id',
  validateParams(transactionIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminTransactionsService.get(String(req.params.id));
    success(res, row);
  }),
);

adminTransactionsController.patch(
  '/:id/mark-settled',
  validateParams(transactionIdParam),
  validateBody(txMarkSettledSchema),
  asyncHandler(async (req, res) => {
    const row = await adminTransactionsService.markSettled(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

adminTransactionsController.post(
  '/:id/refund',
  validateParams(transactionIdParam),
  validateBody(txManualRefundSchema),
  asyncHandler(async (req, res) => {
    const row = await adminTransactionsService.manualRefund(String(req.params.id), req.body, req);
    success(res, row);
  }),
);
