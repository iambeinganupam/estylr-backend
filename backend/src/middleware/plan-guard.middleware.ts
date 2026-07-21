// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Plan Guard
// Gates a route behind an entitlement check.
// Resolves vendor context from req.auth + req.tenant (injected by
// authMiddleware + tenantMiddleware) and calls assertEnabled().
// ─────────────────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';
import * as entitlements from '../modules/entitlements/entitlements.service';
import { USER_ROLE } from '../lib/constants';

function resolveVendorCtx(
  req: Request,
): { vendorType: 'freelancer' | 'salon_location'; vendorId: string; planCode: string } | null {
  if (!req.auth) return null;

  if (req.auth.role === USER_ROLE.FREELANCER) {
    const vendorId = req.tenant?.freelancerProfileId;
    if (!vendorId) return null;
    return {
      vendorType: 'freelancer',
      vendorId,
      planCode: req.tenant?.currentPlanCode ?? 'pay_as_you_go',
    };
  }

  if (req.auth.role === USER_ROLE.BUSINESS_ADMIN) {
    const vendorId = req.tenant?.locationId || req.tenant?.businessId;
    if (!vendorId) return null;
    return {
      vendorType: 'salon_location',
      vendorId,
      planCode: req.tenant?.currentPlanCode ?? 'pay_as_you_go',
    };
  }

  return null;
}

/**
 * Factory: creates middleware that gates a route behind a boolean entitlement.
 * Non-vendor callers (customers, staff, super_admin) pass through without check —
 * upstream roleGuard handles their access.
 *
 * Usage:
 * ```ts
 * router.get('/analytics',
 *   authMiddleware,
 *   roleGuard(USER_ROLE.BUSINESS_ADMIN, USER_ROLE.FREELANCER),
 *   tenantMiddleware,
 *   planGuard('analytics'),
 *   handler,
 * );
 * ```
 */
export function planGuard(featureCode: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = resolveVendorCtx(req);
      if (!ctx) return next(); // not a vendor — let role-guard upstream handle it
      await entitlements.assertEnabled(ctx, featureCode);
      next();
    } catch (err) {
      next(err);
    }
  };
}
