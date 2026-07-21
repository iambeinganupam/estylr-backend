// ─────────────────────────────────────────────────────────────────────────────
// KYC Module — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { success, created } from '../../lib/response';
import * as service from './kyc.service';
import { submitKycSchema } from './kyc.schemas';
import { USER_ROLE, VENDOR_TYPE } from '../../lib/constants';

export const kycController = Router();

/** Resolve vendor type and id from the authenticated tenant context. */
function resolveVendor(req: import('express').Request): {
  vendorType: 'freelancer' | 'salon_location';
  vendorId: string;
} {
  if (req.auth!.role === USER_ROLE.FREELANCER) {
    return { vendorType: VENDOR_TYPE.FREELANCER, vendorId: req.tenant!.freelancerProfileId! };
  }
  return {
    vendorType: VENDOR_TYPE.SALON_LOCATION,
    vendorId: req.tenant!.locationId ?? req.tenant!.businessId!,
  };
}

// Mounted at /api/v1/kyc — paths below are relative to that prefix.

// ── KYC-01: Submit KYC ──
kycController.post(
  '/submit',
  authMiddleware,
  roleGuard(USER_ROLE.FREELANCER, USER_ROLE.BUSINESS_ADMIN),
  tenantMiddleware,
  validateBody(submitKycSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const result = await service.submitKyc({
      vendorType,
      vendorId,
      userId: req.auth!.userId,
      documentType: req.body.document_type,
      documentNumber: req.body.document_number,
      mediaId: req.body.media_id,
      planCode: req.body.plan_code,
    });
    created(res, result);
  }),
);

// ── KYC-02: Get KYC Status ──
kycController.get(
  '/me',
  authMiddleware,
  roleGuard(USER_ROLE.FREELANCER, USER_ROLE.BUSINESS_ADMIN),
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    success(res, await service.getStatus(vendorType, vendorId));
  }),
);
