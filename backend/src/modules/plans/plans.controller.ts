// ─────────────────────────────────────────────────────────────────────────────
// Plans Module — Controller
//
//   GET  /plans                          PUBLIC — render plan cards
//   GET  /plans/me                       AUTH   — vendor's currently effective plan
//   POST /plans/subscribe                AUTH   — switch to a paid plan
//
// Subscribe is restricted to vendor roles (business_admin, freelancer).
// Default-plan fallback is automatic — vendors don't subscribe to it.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { success, created } from '../../lib/response';
import { plansService } from './plans.service';
import { subscribeToPlanSchema } from './plans.schemas';
import { USER_ROLE, VENDOR_TYPE, type VendorType } from '../../lib/constants';

export const plansController = Router();

function resolveVendor(req: import('express').Request): { vendorType: VendorType; vendorId: string } {
  if (req.auth!.role === USER_ROLE.FREELANCER) {
    return { vendorType: VENDOR_TYPE.FREELANCER, vendorId: req.tenant!.freelancerProfileId! };
  }
  return {
    vendorType: VENDOR_TYPE.SALON_LOCATION,
    vendorId: req.tenant!.locationId || req.tenant!.businessId!,
  };
}

// ── Public catalog ──
plansController.get(
  '/',
  asyncHandler(async (_req, res) => {
    const plans = await plansService.list();
    success(res, plans);
  }),
);

// ── Vendor's currently effective plan ──
plansController.get(
  '/me',
  authMiddleware,
  roleGuard(USER_ROLE.BUSINESS_ADMIN, USER_ROLE.FREELANCER),
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const plan = await plansService.getEffectivePlan(vendorType, vendorId);
    success(res, plan);
  }),
);

// ── Subscribe to a paid plan ──
plansController.post(
  '/subscribe',
  authMiddleware,
  roleGuard(USER_ROLE.BUSINESS_ADMIN, USER_ROLE.FREELANCER),
  tenantMiddleware,
  validateBody(subscribeToPlanSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const result = await plansService.subscribe(
      vendorType,
      vendorId,
      req.body.plan_code,
      { waiveFirstMonth: req.body.waive_first_month },
    );
    created(res, result);
  }),
);
