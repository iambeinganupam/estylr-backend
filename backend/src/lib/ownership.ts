import { USER_ROLE, type UserRole } from './constants';
import { ResourceNotFoundError } from './errors';

/** Always-allow check for super_admin role. */
export function isSuperAdmin(role: UserRole | string | undefined): boolean {
  return role === USER_ROLE.SUPER_ADMIN;
}

/**
 * Assert the caller owns the resource.
 *
 * Throws ResourceNotFoundError (not InsufficientRoleError) on mismatch so
 * cross-tenant probes cannot distinguish "does not exist" from "exists but
 * not yours" — preventing existence-leak via 403 vs 404.
 *
 * Pass conditions (any one is enough):
 *   1. callerRole === 'super_admin'
 *   2. callerUserId === resourceOwnerUserId (caller owns the resource directly)
 *   3. callerTenantId === resourceTenantId (intra-tenant access — e.g. a
 *      freelancer viewing their own appointment).
 *   4. callerTenantId === resourceBusinessId (intra-business access — a
 *      business_admin / staff member viewing an appointment that lives
 *      under one of *their business's* locations). business_admin and
 *      staff JWTs carry business_account.id as tenantId, but the
 *      appointment row's tenant column is the salon_location.id —
 *      without this hop the salon dashboard 404s its own bookings.
 *
 * Otherwise throws.
 */
export function assertCallerOwns(params: {
  callerRole: UserRole | string;
  callerUserId: string;
  callerTenantId?: string;
  resourceOwnerUserId?: string;
  resourceTenantId?: string;
  resourceBusinessId?: string | null;
}): void {
  if (isSuperAdmin(params.callerRole)) return;
  if (params.callerUserId && params.resourceOwnerUserId &&
      params.callerUserId === params.resourceOwnerUserId) return;
  if (params.callerTenantId && params.resourceTenantId &&
      params.callerTenantId === params.resourceTenantId) return;
  if (params.callerTenantId && params.resourceBusinessId &&
      params.callerTenantId === params.resourceBusinessId) return;
  throw new ResourceNotFoundError('resource');
}
