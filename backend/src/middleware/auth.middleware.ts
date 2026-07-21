// ─────────────────────────────────────────────────────────────────────────────
// Middleware: JWT Authentication (BP-05)
// ─────────────────────────────────────────────────────────────────────────────
// Extracts Bearer token, verifies JWT, checks token version against DB,
// and injects req.auth with user context. Public routes skip this.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { queryOne } from '../config/database';
import { TokenExpiredError as AppTokenExpiredError, TokenInvalidError } from '../lib/errors';
import { UserRole, VendorType, VENDOR_TYPE } from '../lib/constants';
import { setSentryUser } from '../config/sentry';
import { parseDuration } from '../lib/duration';

interface JwtPayload {
  sub: string;         // user ID
  role: UserRole;
  tenant_id: string;   // profile ID (freelancer, business, customer)
  vendor_type?: VendorType;
  profile_id: string;
  rtv: number;         // refresh_token_version
  iat: number;
  exp: number;
}

/**
 * Auth middleware factory.
 * Use `authMiddleware` for required auth.
 * Use `optionalAuth` for endpoints where auth is optional.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new TokenInvalidError());
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;

    req.auth = {
      userId: decoded.sub,
      role: decoded.role,
      tenantId: decoded.tenant_id,
      vendorType: decoded.vendor_type,
      profileId: decoded.profile_id,
      tokenVersion: decoded.rtv,
    };

    // Verify token version hasn't been invalidated (async check)
    verifyTokenVersion(decoded.sub, decoded.rtv).then((isValid) => {
      if (!isValid) {
        return next(new AppTokenExpiredError());
      }
      // Pin authenticated user to Sentry scope for all events on this request.
      setSentryUser(decoded.sub, decoded.role);
      next();
    }).catch(next);

  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppTokenExpiredError());
    }
    return next(new TokenInvalidError());
  }
}

/**
 * Optional auth — populates req.auth if token present, but doesn't fail.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;

    req.auth = {
      userId: decoded.sub,
      role: decoded.role,
      tenantId: decoded.tenant_id,
      vendorType: decoded.vendor_type,
      profileId: decoded.profile_id,
      tokenVersion: decoded.rtv,
    };
  } catch {
    // Token invalid but auth is optional — proceed without auth
  }

  next();
}

/**
 * Verify that the token version matches the DB.
 * If a user logged out of all devices, their token version is incremented,
 * invalidating all existing tokens.
 */
async function verifyTokenVersion(userId: string, tokenVersion: number): Promise<boolean> {
  const row = await queryOne<{ refresh_token_version: number }>(
    'SELECT refresh_token_version FROM public.users WHERE id = $1 AND deleted_at IS NULL',
    [userId],
  );

  if (!row) return false;
  return row.refresh_token_version === tokenVersion;
}

/**
 * Resolve vendor type from user role.
 */
export function resolveVendorType(role: UserRole): VendorType | undefined {
  switch (role) {
    case 'freelancer':
      return VENDOR_TYPE.FREELANCER;
    case 'business_admin':
    case 'staff':
      return VENDOR_TYPE.SALON_LOCATION;
    default:
      return undefined;
  }
}

/**
 * Generate an access token for a user.
 */
export function generateAccessToken(payload: {
  userId: string;
  role: UserRole;
  tenantId: string;
  vendorType?: VendorType;
  profileId: string;
  tokenVersion: number;
}): string {
  return jwt.sign(
    {
      sub: payload.userId,
      role: payload.role,
      tenant_id: payload.tenantId,
      vendor_type: payload.vendorType,
      profile_id: payload.profileId,
      rtv: payload.tokenVersion,
    },
    env.JWT_SECRET,
    { expiresIn: parseDuration(env.JWT_ACCESS_EXPIRY), algorithm: 'HS256' },
  );
}

/**
 * Generate a refresh token for a user.
 */
export function generateRefreshToken(payload: {
  userId: string;
  tokenVersion: number;
}): string {
  return jwt.sign(
    {
      sub: payload.userId,
      rtv: payload.tokenVersion,
      type: 'refresh',
    },
    env.JWT_SECRET,
    { expiresIn: parseDuration(env.JWT_REFRESH_EXPIRY), algorithm: 'HS256' },
  );
}

