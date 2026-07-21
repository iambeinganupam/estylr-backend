// ─────────────────────────────────────────────────────────────────────────────
// Middleware: KYC Guard
//
// Gates vendor write routes behind KYC approval. Placed after authMiddleware
// and tenantMiddleware so req.auth and req.tenant are populated.
//
// v1 CONSERVATIVE COVERAGE — only applied to:
//   • catalog service/product writes (POST/PUT/DELETE /catalog/services|products)
//   • assignment writes
//
// Deliberately NOT applied to:
//   • /auth/*         — onboarding paths
//   • /kyc/*          — would be circular (can't submit if blocked)
//   • /plans/*        — vendor needs to see plans before submitting KYC
//   • /me/addresses/* — profile data needed during onboarding
//   • /freelancers/me GET/PATCH — vendor still edits basic profile during onboarding
//   • /notifications/* — operational; never blocked
//   • /media/*        — vendor must be able to upload the document before submitting
//
// Full coverage matrix (availability, booking, etc.) is a follow-up hardening pass.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';
import { USER_ROLE } from '../lib/constants';
import * as kycRepo from '../modules/kyc/kyc.repository';
import { KycPendingError, KycRejectedError } from '../lib/errors';

export async function kycGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    // Only applies to vendor roles.
    if (!req.auth) return next();
    const { role } = req.auth;
    if (role !== USER_ROLE.FREELANCER && role !== USER_ROLE.BUSINESS_ADMIN) return next();

    const vendorType = role === USER_ROLE.FREELANCER ? 'freelancer' : 'salon_location';
    const vendorId = role === USER_ROLE.FREELANCER
      ? req.tenant?.freelancerProfileId
      : (req.tenant?.locationId ?? req.tenant?.businessId);

    // If we can't resolve the vendor (e.g. tenant middleware hasn't run), let it through
    // and let tenantMiddleware handle the error on its own.
    if (!vendorId) return next();

    const latest = await kycRepo.findLatestForVendor(vendorType, vendorId, true);

    if (!latest) {
      // No submission at all — vendor hasn't started KYC.
      return next(new KycPendingError({ vendorType, vendorId, status: 'not_started' }));
    }

    if (latest.status === 'rejected') {
      return next(new KycRejectedError(latest.rejection_reason ?? 'unspecified'));
    }

    if (latest.status !== 'approved') {
      // submitted, auto_passed, or auto_flagged — still pending admin review.
      return next(new KycPendingError({ vendorType, vendorId, status: latest.status }));
    }

    // KYC approved — allow through.
    next();
  } catch (err) {
    next(err);
  }
}
