// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Tenant Context Injection (BP-05)
// ─────────────────────────────────────────────────────────────────────────────
// The frontend NEVER sends business_id or vendor_id as a parameter.
// The backend extracts it from the JWT and injects into req.tenant.
// This eliminates IDOR vulnerabilities at the protocol level.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { queryOne } from '../config/database';
import { TenantMismatchError } from '../lib/errors';

/**
 * Tenant context middleware.
 * Resolves the tenant identity from the authenticated user's JWT.
 *
 * - Freelancer: sets freelancerProfileId
 * - Business admin: sets businessId, optionally locationId from X-Location-Id header
 * - Staff: resolves employer and sets accordingly
 */
export async function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth) {
      return next();
    }

    const { role, tenantId, userId } = req.auth;

    switch (role) {
      case 'freelancer': {
        const fp = await queryOne<{ current_plan_code: string | null }>(
          `SELECT current_plan_code FROM public.freelancer_profiles WHERE id = $1`,
          [tenantId],
        );
        req.tenant = {
          freelancerProfileId: tenantId,
          currentPlanCode: fp?.current_plan_code ?? 'pay_as_you_go',
        };
        break;
      }

      case 'business_admin': {
        const headerLocationId = req.headers['x-location-id'] as string | undefined;
        let resolvedLocationId: string | undefined;

        if (headerLocationId) {
          // Caller explicitly picked a location — verify it belongs to this business.
          const location = await queryOne<{ id: string }>(
            `SELECT id FROM public.salon_locations
             WHERE id = $1 AND business_account_id = $2 AND is_active = TRUE`,
            [headerLocationId, tenantId],
          );
          if (!location) {
            throw new TenantMismatchError();
          }
          resolvedLocationId = headerLocationId;
        } else {
          // No explicit choice — fall back to the business's primary (oldest
          // active) location. This is what every salon catalog / media / booking
          // operation needs, and not setting it has caused data-integrity bugs
          // where `vendor_id` was persisted as `business_account_id` instead.
          // We resolve here so downstream code can rely on `req.tenant.locationId`
          // being a real `salon_locations.id` for any salon_location-scoped write.
          const primary = await queryOne<{ id: string }>(
            `SELECT id FROM public.salon_locations
             WHERE business_account_id = $1 AND is_active = TRUE
             ORDER BY created_at LIMIT 1`,
            [tenantId],
          );
          resolvedLocationId = primary?.id;
        }

        const ba = await queryOne<{ current_plan_code: string | null }>(
          `SELECT current_plan_code FROM public.business_accounts WHERE id = $1`,
          [tenantId],
        );

        req.tenant = {
          businessId: tenantId,
          locationId: resolvedLocationId,
          currentPlanCode: ba?.current_plan_code ?? 'pay_as_you_go',
        };
        break;
      }

      case 'staff': {
        // Staff: resolve employer (always a salon_location per the schema).
        const staff = await queryOne<{ employer_id: string }>(
          `SELECT employer_id FROM public.staff_members
           WHERE user_id = $1 AND is_active = TRUE`,
          [userId],
        );

        if (!staff) {
          throw new TenantMismatchError();
        }

        const location = await queryOne<{ business_account_id: string }>(
          `SELECT business_account_id FROM public.salon_locations WHERE id = $1`,
          [staff.employer_id],
        );

        req.tenant = {
          businessId: location?.business_account_id,
          locationId: staff.employer_id,
        };
        break;
      }

      default:
        // Customers don't need tenant context
        break;
    }

    next();
  } catch (error) {
    next(error);
  }
}
