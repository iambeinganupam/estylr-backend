// ─────────────────────────────────────────────────────────────────────────────
// Finance Module — Controller (FIN-01 through FIN-07)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created } from '../../lib/response';
import { financeService } from './finance.service';
import { z } from 'zod';
import {
  txListSchema, createPaymentSchema, processPayoutSchema, bankAccountSchema,
  exportSchema, payoutPeriodSchema, txIdParam,
  upiQrRequestSchema, recordSettlementSchema,
} from './finance.schemas';
import { USER_ROLE, VENDOR_TYPE, type VendorType } from '../../lib/constants';

export const financeController = Router();
financeController.use(authMiddleware);
financeController.use(roleGuard('freelancer', 'business_admin', 'staff', 'super_admin'));
financeController.use(tenantMiddleware);

function getVendorId(req: import('express').Request): string {
  return (req.tenant?.freelancerProfileId || req.tenant?.businessId) as string;
}

/** Same vendor-resolution rule used by the availability controller — one
 *  source of truth for "what vendor is this caller acting as". */
function resolveVendor(req: import('express').Request): { vendorType: VendorType; vendorId: string } {
  if (req.auth!.role === USER_ROLE.FREELANCER) {
    return { vendorType: VENDOR_TYPE.FREELANCER, vendorId: req.tenant!.freelancerProfileId! };
  }
  return {
    vendorType: VENDOR_TYPE.SALON_LOCATION,
    vendorId: req.tenant!.locationId || req.tenant!.businessId!,
  };
}

// ── FIN-01: List Transactions ──
// Reads from `transactions` keyed on `vendor_id = salon_location.id`
// (set by createPayment), so we resolve through location.id rather than
// the business_account.id that getVendorId returns. See 7a76723.
financeController.get(
  '/transactions',
  validateQuery(txListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof txListSchema>;
    const { vendorId } = resolveVendor(req);
    const rows = await financeService.listTransactions(vendorId, {
      fromDate: q.from_date, toDate: q.to_date, status: q.status, limit: q.limit,
    });
    success(res, rows);
  }),
);

// ── FIN-02: Get Transaction Detail ──
financeController.get(
  '/transactions/:id',
  validateParams(txIdParam),
  asyncHandler(async (req, res) => {
    const tx = await financeService.getTransaction(String(req.params.id), {
      userId: req.auth!.userId,
      role: req.auth!.role,
      vendorId: resolveVendor(req).vendorId,
    });
    success(res, tx);
  }),
);

// ── FIN-02b: Get Bill (printable invoice) ──
//   Uniform payload across walk-in, subscriber, and Kshuri-direct customers.
//   Used by the frontend BillModal to render + print, and (future) to email
//   or SMS the bill to registered customers.
financeController.get(
  '/transactions/:id/bill',
  validateParams(txIdParam),
  asyncHandler(async (req, res) => {
    const { vendorId } = resolveVendor(req);
    const bill = await financeService.getBill(String(req.params.id), vendorId);
    success(res, bill);
  }),
);

// ── FIN-03: Get Pending Payouts (Harmony Hub) ──
financeController.get(
  '/payouts/pending',
  roleGuard('business_admin'),
  validateQuery(payoutPeriodSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof payoutPeriodSchema>;
    const businessId = req.tenant!.businessId!;
    const payouts = await financeService.getPendingPayouts(businessId, q.period);
    success(res, payouts);
  }),
);

// ── FIN-04: Process Payout Batch ──
financeController.post(
  '/payouts/process',
  roleGuard('business_admin'),
  validateBody(processPayoutSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.tenant!.businessId!;
    const results = await financeService.processPayouts(
      businessId, req.body.staff_ids, req.body.period_start, req.body.period_end,
    );
    created(res, results);
  }),
);

// ── FIN-05: Get Settlement History ──
financeController.get(
  '/settlements',
  asyncHandler(async (req, res) => {
    const vendorId = getVendorId(req);
    const settlements = await financeService.getSettlements(vendorId);
    success(res, settlements);
  }),
);

// ── FIN-06a: Get Bank Account ──
financeController.get(
  '/bank-account',
  asyncHandler(async (req, res) => {
    const vendorId = getVendorId(req);
    const account = await financeService.getBankAccount(vendorId);
    success(res, account);
  }),
);

// ── FIN-06b: Update Bank Account ──
financeController.put(
  '/bank-account',
  validateBody(bankAccountSchema),
  asyncHandler(async (req, res) => {
    const vendorId = getVendorId(req);
    const account = await financeService.updateBankAccount(vendorId, req.body);
    success(res, account);
  }),
);

// ── FIN-07: Export Financial Report ──
financeController.get(
  '/export',
  validateQuery(exportSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof exportSchema>;
    const { vendorId } = resolveVendor(req);
    const rows = await financeService.getExportData(vendorId, q.type, q.start_date, q.end_date);

    if (q.format === 'csv') {
      const csv = financeService.formatCsv(rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${q.type}_${q.start_date}_${q.end_date}.csv"`);
      res.send(csv);
      return;
    }

    // PDF — return JSON data with note (PDF generation requires a separate library)
    success(res, { format: 'pdf', note: 'PDF export not yet implemented. Use CSV format.', rows });
  }),
);

// ── Revenue Summary (bonus: not in spec but useful) ──
financeController.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { vendorId } = resolveVendor(req);
    const summary = await financeService.getRevenueSummary(vendorId);
    success(res, summary);
  }),
);

// ── Payment Intent (Create) ──
financeController.post(
  '/payments',
  validateBody(createPaymentSchema),
  asyncHandler(async (req, res) => {
    // `appointments.vendor_id` is the salon_location.id for salons (one
    // business → many locations). getVendorId returns business_account.id
    // for business_admin, which would never match. resolveVendor picks
    // location.id when present, so the salon dashboard's "Collect Cash"
    // CTA stops failing with TENANT_MISMATCH on its own bookings.
    const { vendorId } = resolveVendor(req);
    const tx = await financeService.createPayment(
      vendorId,
      req.body.appointment_id,
      req.body.payment_method,
      req.body.currency,
      req.body.amount,
    );
    created(res, tx);
  }),
);

// ── Vendor-collected UPI: build a deep-link / QR payload for the customer ──
financeController.post(
  '/payments/qr',
  roleGuard(USER_ROLE.BUSINESS_ADMIN, USER_ROLE.FREELANCER),
  validateBody(upiQrRequestSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const payload = await financeService.generateUpiQrPayload(
      vendorType, vendorId, req.body.appointment_id, req.body.amount,
    );
    success(res, payload);
  }),
);

// ── Vendor dues: outstanding balance + recent ledger ──
financeController.get(
  '/dues',
  roleGuard(USER_ROLE.BUSINESS_ADMIN, USER_ROLE.FREELANCER),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const dues = await financeService.getDues(vendorType, vendorId);
    success(res, dues);
  }),
);

// ── Record a settlement payment (vendor → platform) ──
//   Phase 1: super admin posts manually (after confirming UPI receipt).
//   Phase 2: webhook-driven when we wire a gateway. The schema accepts
//   an optional vendor_{id,type} pair so a super admin can settle on
//   behalf of someone; without it the caller settles their own dues.
financeController.post(
  '/dues/settle',
  validateBody(recordSettlementSchema),
  asyncHandler(async (req, res) => {
    const isSuperAdmin = req.auth!.role === USER_ROLE.SUPER_ADMIN;
    let vendorType: VendorType;
    let vendorId: string;
    if (req.body.vendor_id) {
      if (!isSuperAdmin) {
        // Only super admins may settle on behalf of another vendor.
        const own = resolveVendor(req);
        vendorType = own.vendorType;
        vendorId = own.vendorId;
      } else {
        vendorType = req.body.vendor_type;
        vendorId = req.body.vendor_id;
      }
    } else {
      const own = resolveVendor(req);
      vendorType = own.vendorType;
      vendorId = own.vendorId;
    }
    const entry = await financeService.recordSettlement({
      vendorType, vendorId,
      amount: req.body.amount,
      externalRef: req.body.external_ref,
      notes: req.body.notes,
      actingUserId: req.auth!.userId,
    });
    created(res, entry);
  }),
);
