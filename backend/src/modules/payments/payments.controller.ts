// ─────────────────────────────────────────────────────────────────────────────
// Payments Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
// Two routes:
//   POST /payments/refund/:id  — super_admin initiates a refund
//   GET  /payments/transactions — vendor/admin lists own transactions
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { paymentsService } from './payments.service';
import {
  refundRequestSchema,
  txIdParamSchema,
  listTransactionsQuerySchema,
} from './payments.schemas';

export const paymentsController = Router();
paymentsController.use(authMiddleware);

// ── POST /payments/refund/:id ─────────────────────────────────────────────────
paymentsController.post(
  '/refund/:id',
  roleGuard(USER_ROLE.SUPER_ADMIN),
  validateParams(txIdParamSchema),
  validateBody(refundRequestSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof txIdParamSchema>;
    const { reason } = req.body as z.infer<typeof refundRequestSchema>;
    const tx = await paymentsService.processRefund(id, reason, req);
    success(res, tx);
  }),
);

// ── GET /payments/transactions ────────────────────────────────────────────────
paymentsController.get(
  '/transactions',
  roleGuard(USER_ROLE.BUSINESS_ADMIN, USER_ROLE.FREELANCER, USER_ROLE.SUPER_ADMIN),
  validateQuery(listTransactionsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listTransactionsQuerySchema>;
    // Super-admin can pass ?vendor_id= in future; vendors use their own profileId.
    const vendorId = req.auth!.profileId;
    const result = await paymentsService.listVendorTransactions(vendorId, q);
    success(res, result.rows, { total: result.total, limit: q.limit });
  }),
);
