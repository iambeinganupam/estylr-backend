// ─────────────────────────────────────────────────────────────────────────────
// Auth Module — Controller (Route Definitions)
// ─────────────────────────────────────────────────────────────────────────────
// Security Model (Best Practice):
//   • access_token  → returned in JSON body only; stored in-memory by client
//   • refresh_token → set as httpOnly, Secure, SameSite=Strict cookie ONLY
//     This pattern prevents XSS from stealing the refresh token while keeping
//     the access token out of persistent storage entirely.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { authRateLimiter } from '../../middleware/rate-limit.middleware';
import { success, created } from '../../lib/response';
import { ValidationError, TokenInvalidError } from '../../lib/errors';
import { parseDuration } from '../../lib/duration';
import { authService } from './auth.service';
import { env } from '../../config/env';
import {
  AUDIENCE_HEADER,
  type AudienceKey,
  isAudienceKey,
  refreshCookieName,
} from '../../lib/audiences';
import {
  requestOtpSchema,
  verifyOtpSchema,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  oauthGoogleSchema,
  verifyFirebaseTokenSchema,
  verifyEmailTokenSchema,
} from './auth.schemas';

export const authController = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Audience + Cookie Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Refresh token cookie TTL — derived from JWT_REFRESH_EXPIRY so they stay in sync */
const REFRESH_COOKIE_TTL_MS = parseDuration(env.JWT_REFRESH_EXPIRY) * 1000;

/**
 * Read & validate the `X-Kshuri-Audience` header. Each dashboard sends its
 * audience id (`salon`, `freelancer`, …) on every /auth/* call so the server
 * can enforce role-vs-audience and scope refresh cookies per audience.
 *
 * Throws `ValidationError` if the header is missing or unknown — never
 * defaults silently, because doing so would let a misconfigured client
 * obtain tokens it shouldn't.
 */
function getAudience(req: Request): AudienceKey {
  const raw = req.headers[AUDIENCE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!isAudienceKey(value)) {
    throw new ValidationError({
      header: AUDIENCE_HEADER,
      message: `Missing or invalid "${AUDIENCE_HEADER}" header. Expected one of: salon, freelancer, staff, customer, events, admin.`,
      received: value ?? null,
    });
  }
  return value;
}

/**
 * Sets the audience-scoped httpOnly refresh-token cookie. Audience scoping
 * means a freelancer's session cookie is named differently from a salon
 * admin's — so cookies cannot bleed across dashboards on a shared host
 * (e.g. localhost). Each dashboard reads only its own cookie.
 */
/**
 * Build the shared refresh-cookie attribute set.
 *
 * `Domain` is intentionally omitted when COOKIE_DOMAIN is unset OR when it is
 * literally "localhost". Browsers (per RFC 6265 + WHATWG HTML's public-suffix
 * handling) reject cookies whose `Domain` attribute is `localhost`, because
 * `localhost` is not a registrable suffix. The result on dev is a silent
 * "Set-Cookie that doesn't actually set" — every page refresh then looks like
 * a logout because the silent-refresh has no cookie to present.
 *
 * In staging/prod set COOKIE_DOMAIN to a real domain (e.g. `.kshuri.app`)
 * to scope the cookie across subdomains.
 */
function refreshCookieOptions() {
  const domain = env.COOKIE_DOMAIN && env.COOKIE_DOMAIN !== 'localhost' ? env.COOKIE_DOMAIN : undefined;
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    // 'lax' (not 'strict') so the cookie rides top-level navigations across
    // the :3001 ↔ :3000 dev pair and survives SSR refreshes in prod.
    sameSite: 'lax' as const,
    ...(domain ? { domain } : {}),
    // path='/' so the portal's `proxy.ts` edge gate can read the cookie when
    // it gates `/book/*`, `/dashboard`, `/wishlist`, etc. Scoping to
    // `/api/v1/auth` made the cookie invisible to the proxy and bounced
    // every authenticated navigation back to /login.
    path: '/',
  };
}

function setRefreshCookie(res: Response, audience: AudienceKey, refreshToken: string): void {
  // Defensive: clear the legacy path-scoped cookie before setting the new
  // root-scoped one. A cookie with a different `path` is a *separate*
  // cookie under browser semantics, so changing the option in code leaves
  // the old cookie sitting in the browser indefinitely — and cookie-parser
  // can pick the stale value, returning 401 on /auth/refresh. This is a
  // one-shot transition aid and is safe to leave in: clearing a cookie
  // that doesn't exist is a no-op.
  res.clearCookie(refreshCookieName(audience), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
  });

  res.cookie(refreshCookieName(audience), refreshToken, {
    ...refreshCookieOptions(),
    maxAge: REFRESH_COOKIE_TTL_MS,
  });
}

/** Clears the audience-scoped refresh-token cookie (used on logout). */
function clearRefreshCookie(res: Response, audience: AudienceKey): void {
  // Defensive: clear at both the legacy and current paths so stale browser
  // state from before the path migration self-heals on the next failed
  // refresh / explicit logout. Two clearCookie calls = two Set-Cookie
  // headers, browser deletes whichever matches.
  res.clearCookie(refreshCookieName(audience), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
  });
  res.clearCookie(refreshCookieName(audience), refreshCookieOptions());
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-01: Request OTP
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/request-otp',
  authRateLimiter,
  validateBody(requestOtpSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.requestOtp(req.body.phone_number);
    success(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-02: Verify OTP (B2C Login)
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/verify-otp',
  authRateLimiter,
  validateBody(verifyOtpSchema),
  asyncHandler(async (req, res) => {
    const audience = getAudience(req);
    const result = await authService.verifyOtp(req.body.phone_number, req.body.otp_code, audience);
    setRefreshCookie(res, audience, result.refresh_token);
    // Do NOT return refresh_token in the response body
    const { refresh_token: _omit, ...safeResult } = result;
    success(res, safeResult);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-03: Register (B2B Freelancer / Manager)
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/register',
  authRateLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const audience = getAudience(req);
    const { first_name, last_name, phone_number, business_name, legal_business_name, ...rest } = req.body;
    const result = await authService.register({
      ...rest,
      firstName: first_name,
      lastName: last_name,
      phoneNumber: phone_number,
      businessName: business_name,
      legalBusinessName: legal_business_name,
      audience,
    });
    setRefreshCookie(res, audience, result.refresh_token);
    const { refresh_token: _omit, ...safeResult } = result;
    created(res, safeResult);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-04: Login (B2B Email + Password)
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/login',
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const audience = getAudience(req);
    const result = await authService.login(req.body.email, req.body.password, audience);
    setRefreshCookie(res, audience, result.refresh_token);
    const { refresh_token: _omit, ...safeResult } = result;
    success(res, safeResult);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-05: Refresh Access Token
// Reads refresh token from httpOnly cookie — no body parameter needed.
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const audience = getAudience(req);
    // Read ONLY this audience's cookie — never the global / other-audience
    // cookie. This is what stops a stale freelancer session from refreshing
    // the salon dashboard back in.
    const refreshToken = req.cookies?.[refreshCookieName(audience)] as string | undefined;

    if (!refreshToken) {
      // Self-heal: nothing to refresh, ensure no stale cookie lingers either.
      clearRefreshCookie(res, audience);
      throw new TokenInvalidError();
    }

    try {
      const result = await authService.refreshAccessToken(refreshToken, audience);
      setRefreshCookie(res, audience, result.refresh_token);
      // Only return the new access_token — refresh token stays in cookie
      success(res, { access_token: result.access_token });
    } catch (err) {
      // Any refresh failure (expired, rotated rtv, deleted user) — wipe the
      // bad cookie at both the legacy and current paths so the client's next
      // login starts from a clean slate instead of looping on a stale value.
      clearRefreshCookie(res, audience);
      throw err;
    }
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-06: Get My Profile
// ─────────────────────────────────────────────────────────────────────────────
authController.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const profile = await authService.getProfile(req.auth!.userId, req.auth!.role);
    success(res, profile);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-07: Update Profile
// ─────────────────────────────────────────────────────────────────────────────
authController.put(
  '/me',
  authMiddleware,
  validateBody(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const profile = await authService.updateProfile(req.auth!.userId, req.auth!.role, req.body);
    success(res, profile);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-08a: Forgot Password
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/forgot-password',
  authRateLimiter,
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.forgotPassword(req.body.email);
    success(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-08b: Reset Password
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/reset-password',
  authRateLimiter,
  validateBody(resetPasswordSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.resetPassword(req.body.token, req.body.new_password);
    success(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-08c: Change Password (authenticated)
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/change-password',
  authMiddleware,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.changePassword(
      req.auth!.userId,
      req.body.current_password,
      req.body.new_password,
    );
    success(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-09: Logout — clears cookie + increments token version
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const audience = getAudience(req);
    await authService.logout(req.auth!.userId);
    clearRefreshCookie(res, audience);
    success(res, { message: 'Logged out. All sessions invalidated.' });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-10: Google OAuth
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/oauth/google',
  authRateLimiter,
  validateBody(oauthGoogleSchema),
  asyncHandler(async (req, res) => {
    const audience = getAudience(req);
    const result = await authService.authenticateWithGoogle(req.body.id_token, req.body.role, audience);
    setRefreshCookie(res, audience, result.refresh_token);
    const { refresh_token: _omit, ...safeResult } = result;
    success(res, safeResult);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-11: Verify Firebase Phone Token (B2C OTP via Firebase client SDK)
// Client completes Firebase phone auth → sends Firebase ID token here.
// Backend verifies token, finds/creates user, issues our own JWT.
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/oauth/firebase-phone',
  authRateLimiter,
  validateBody(verifyFirebaseTokenSchema),
  asyncHandler(async (req, res) => {
    const audience = getAudience(req);
    const result = await authService.verifyFirebaseToken({ ...req.body, audience });
    setRefreshCookie(res, audience, result.refresh_token);
    const { refresh_token: _omit, ...safeResult } = result;
    success(res, safeResult);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-12: Send Verification Email (authenticated)
// ─────────────────────────────────────────────────────────────────────────────
authController.post(
  '/send-verification-email',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await authService.sendVerificationEmail(req.auth!.userId);
    success(res, result);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-13: Verify Email Token (link from verification email)
// Called when user clicks the link in their inbox. Returns JSON so apps can
// redirect to a success page; browser-accessible URL.
// ─────────────────────────────────────────────────────────────────────────────
authController.get(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const parsed = verifyEmailTokenSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError({ field: 'token', message: 'Invalid or missing verification token.' });
    }
    const result = await authService.verifyEmailToken(parsed.data.token);
    success(res, result);
  }),
);

// ── AUTH-EXT-01: Get uploaded documents ──
authController.get(
  '/documents',
  authMiddleware,
  roleGuard('freelancer', 'business_admin', 'super_admin'),
  asyncHandler(async (req, res) => {
    const docs = await authService.getDocuments(req.auth!.userId);
    success(res, docs);
  }),
);

// ── AUTH-EXT-02: Get bank/payout details ──
authController.get(
  '/bank-details',
  authMiddleware,
  roleGuard('freelancer', 'business_admin', 'super_admin'),
  asyncHandler(async (req, res) => {
    const details = await authService.getBankDetails(req.auth!.userId);
    success(res, details);
  }),
);
