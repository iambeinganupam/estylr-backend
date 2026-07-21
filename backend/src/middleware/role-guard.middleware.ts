// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Role Guard — RBAC enforcement
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { InsufficientRoleError } from '../lib/errors';
import { UserRole } from '../lib/constants';

/**
 * Factory: creates middleware that restricts access to specific roles.
 *
 * Usage:
 * ```ts
 * router.post('/intents', authMiddleware, roleGuard('customer'), handler);
 * router.get('/staff', authMiddleware, roleGuard('business_admin', 'staff'), handler);
 * ```
 */
export function roleGuard(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      throw new InsufficientRoleError(allowedRoles);
    }

    if (!allowedRoles.includes(req.auth.role)) {
      throw new InsufficientRoleError(allowedRoles);
    }

    next();
  };
}
