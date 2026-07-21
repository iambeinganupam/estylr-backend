// ─────────────────────────────────────────────────────────────────────────────
// Auth Module — Service Layer (Business Logic)
// ─────────────────────────────────────────────────────────────────────────────
// Handles OTP generation/verification, registration, login, token refresh,
// Google OAuth, and password management. No HTTP concerns.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { authRepository } from './auth.repository';
import { getDefaultForUser as getDefaultAddress } from '../addresses/addresses.repository';
import { getStatus as getKycStatus } from '../kyc/kyc.service';
import { getSmsProvider, getOtpProvider, getEmailProvider } from '../../adapters';
import { authLoginsTotal, otpAttemptsTotal } from '../../lib/metrics';
import {
  generateAccessToken,
  generateRefreshToken,
  resolveVendorType,
} from '../../middleware/auth.middleware';
import {
  InvalidCredentialsError,
  InvalidOtpError,
  EmailExistsError,
  PhoneExistsError,
  PhoneNotRegisteredError,
  TokenInvalidError,
  TokenExpiredError,
  OAuthError,
  ResourceNotFoundError,
  RoleMismatchError,
  RateLimitError,
} from '../../lib/errors';
import { env } from '../../config/env';
import { query } from '../../config/database';
import { logger } from '../../config/logger';
import { UserRole } from '../../lib/constants';
import {
  AUDIENCES,
  type AudienceKey,
  isRoleAllowedForAudience,
} from '../../lib/audiences';
import type { UserRow } from './auth.repository';
import jwt from 'jsonwebtoken';

/**
 * Server-authoritative audience guard. Throws RoleMismatchError if the user's
 * role isn't authorised for the dashboard requesting the auth. Called from
 * every token-issuing path so a stolen/stale credential of the wrong role
 * cannot establish a session.
 */
function ensureRoleForAudience(role: UserRole, audience: AudienceKey): void {
  if (!isRoleAllowedForAudience(role, audience)) {
    throw new RoleMismatchError({ audience, existingRole: role });
  }
}

/**
 * Best-effort audit row for user creation paths. Does not require Express req
 * (services have no HTTP concerns). Uses the new user's own id as admin_user_id
 * since there is no admin actor — the user is the subject of their own signup.
 * Errors are swallowed to match the existing audit-log failure semantics (the
 * signup must succeed even if the audit row cannot be persisted).
 */
async function emitUserCreatedAudit(userId: string, role: string, via: string): Promise<void> {
  try {
    await query(
      `INSERT INTO public.audit_log
         (admin_user_id, action, entity_type, entity_id, payload_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, 'user.created', 'user', userId, JSON.stringify({ role, via })],
    );
  } catch (err) {
    logger.error({ err, userId }, 'audit_log user.created insert failed');
  }
}

// ── Configurable Constants (no magic numbers) ──
const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MIN = Math.pow(10, OTP_LENGTH - 1);   // 100000
const OTP_MAX = Math.pow(10, OTP_LENGTH) - 1;   // 999999
const AUTO_PHONE_EMAIL_DOMAIN = 'phone.kshuri.com';
const DEFAULT_PHONE_USER_FIRST_NAME = 'User';

// Google OAuth client (lazy-initialized)
let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!googleClient) {
    googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }
  return googleClient;
}

export const authService = {
  // ── AUTH-01: Request OTP ──

  async requestOtp(phoneNumber: string): Promise<{ otp_code?: string; message: string }> {
    // Generate OTP code of configured length
    const code = (Math.floor(Math.random() * (OTP_MAX - OTP_MIN + 1)) + OTP_MIN).toString();

    // Hash and persist OTP with configured TTL
    const codeHash = await bcrypt.hash(code, env.BCRYPT_ROUNDS);
    await authRepository.upsertOtp(phoneNumber, codeHash, OTP_TTL_MS);

    // Send via SMS provider
    const sms = getSmsProvider();
    await sms.sendOtp(phoneNumber, code);

    return env.SMS_PROVIDER === 'console'
      ? { otp_code: code, message: 'OTP sent successfully.' }
      : { message: 'OTP sent successfully.' };
  },

  // ── AUTH-02: Verify OTP ──

  async verifyOtp(phoneNumber: string, otpCode: string, audience: AudienceKey): Promise<{
    access_token: string;
    refresh_token: string;
    user: Record<string, unknown>;
    is_new_user: boolean;
  }> {
    // Verify OTP (Postgres-backed with brute-force cap)
    const MAX_ATTEMPTS = 5;
    const row = await authRepository.findOtp(phoneNumber);
    if (!row) throw new InvalidOtpError();
    if (new Date(row.expires_at) <= new Date()) {
      await authRepository.deleteOtp(phoneNumber);
      throw new InvalidOtpError();
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new RateLimitError('OTP attempt limit reached. Request a new code.');
    }

    const ok = await bcrypt.compare(otpCode, row.code_hash);
    if (!ok) {
      await authRepository.recordOtpAttempt(phoneNumber);
      otpAttemptsTotal.inc({ outcome: 'wrong_code' });
      throw new InvalidOtpError();
    }

    // Single-use — delete on success.
    await authRepository.deleteOtp(phoneNumber);
    otpAttemptsTotal.inc({ outcome: 'success' });

    // Find or create user
    let user = await authRepository.findUserByPhone(phoneNumber);
    let isNewUser = false;

    if (!user) {
      // Auto-register as customer on first OTP login
      const sanitizedPhone = phoneNumber.replace(/\+/g, '');
      const result = await authRepository.createCustomer({
        email: `${sanitizedPhone}@${AUTO_PHONE_EMAIL_DOMAIN}`,
        passwordHash: '',
        phoneNumber,
        firstName: DEFAULT_PHONE_USER_FIRST_NAME,
        lastName: '',
      });
      await emitUserCreatedAudit(result.userId, 'customer', 'otp');
      user = await authRepository.findUserById(result.userId);
      isNewUser = true;
    }

    if (!user) {
      throw new InvalidOtpError();
    }

    ensureRoleForAudience(user.role, audience);

    // Generate tokens
    const profileId = await authRepository.resolveProfileId(user.id, user.role);
    const vendorType = resolveVendorType(user.role);

    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      tenantId: profileId,
      vendorType,
      profileId,
      tokenVersion: user.refresh_token_version,
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      tokenVersion: user.refresh_token_version,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone_number: user.phone_number,
        role: user.role,
      },
      is_new_user: isNewUser,
    };
  },

  // ── AUTH-03: Register ──

  async register(params: {
    email: string;
    password: string;
    role: UserRole;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    businessName?: string;
    legalBusinessName?: string;
    audience: AudienceKey;
  }): Promise<{
    access_token: string;
    refresh_token: string;
    user: Record<string, unknown>;
  }> {
    // Server-authoritative gate: a dashboard's signup may only mint a role
    // that audience permits. Stops e.g. a craftily-formed body trying to
    // register a `super_admin` from the salon signup form.
    ensureRoleForAudience(params.role, params.audience);

    // Audience-scoped uniqueness checks: a salon admin and a freelancer can
    // share the same email/phone, each maintaining their own decoupled
    // identity. So we only reject when the conflict is within THIS role.
    const existingEmail = await authRepository.findUserByEmail(params.email, params.role);
    if (existingEmail) {
      throw new EmailExistsError();
    }

    if (params.phoneNumber) {
      const existingPhone = await authRepository.findUserByPhone(params.phoneNumber, params.role);
      if (existingPhone) {
        throw new PhoneExistsError({ existingRole: existingPhone.role });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(params.password, env.BCRYPT_ROUNDS);

    // Create user + profile in transaction
    let result: { userId: string; profileId: string };

    switch (params.role) {
      case 'customer':
        result = await authRepository.createCustomer({
          email: params.email,
          passwordHash,
          phoneNumber: params.phoneNumber,
          firstName: params.firstName,
          lastName: params.lastName,
        });
        await emitUserCreatedAudit(result.userId, 'customer', 'email-password');
        break;

      case 'freelancer':
        result = await authRepository.createFreelancer({
          email: params.email,
          passwordHash,
          phoneNumber: params.phoneNumber,
          firstName: params.firstName,
          lastName: params.lastName,
          businessName: params.businessName!,
        });
        await emitUserCreatedAudit(result.userId, 'freelancer', 'email-password');
        break;

      case 'business_admin':
        result = await authRepository.createBusinessAdmin({
          email: params.email,
          passwordHash,
          phoneNumber: params.phoneNumber,
          firstName: params.firstName,
          lastName: params.lastName,
          legalBusinessName: params.legalBusinessName!,
        });
        await emitUserCreatedAudit(result.userId, 'business_admin', 'email-password');
        break;

      case 'event_manager':
        result = await authRepository.createEventManager({
          email: params.email,
          passwordHash,
          phoneNumber: params.phoneNumber,
          firstName: params.firstName,
          lastName: params.lastName,
        });
        await emitUserCreatedAudit(result.userId, 'event_manager', 'email-password');
        break;

      default:
        throw new InvalidCredentialsError();
    }

    // Get fresh user record
    const user = await authRepository.findUserById(result.userId);
    if (!user) throw new InvalidCredentialsError();

    const vendorType = resolveVendorType(user.role);

    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      tenantId: result.profileId,
      vendorType,
      profileId: result.profileId,
      tokenVersion: user.refresh_token_version,
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      tokenVersion: user.refresh_token_version,
    });

    // Send verification email asynchronously (don't block registration)
    this.sendVerificationEmail(result.userId).catch(() => {
      // Non-fatal — user can re-request via POST /auth/send-verification-email
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone_number: user.phone_number,
        role: user.role,
        profile_id: result.profileId,
      },
    };
  },

  // ── AUTH-04: Login ──

  async login(email: string, password: string, audience: AudienceKey): Promise<{
    access_token: string;
    refresh_token: string;
    user: Record<string, unknown>;
  }> {
    // Audience-scoped lookup: same email can register independently across
    // roles (per migration 055), so we narrow the lookup to roles allowed
    // for this audience. The fallback to un-scoped lookup keeps legacy
    // single-role rows reachable until they're either re-keyed or expire.
    const allowedRoles = AUDIENCES[audience].roles as readonly UserRole[];
    let user: UserRow | null = null;
    for (const r of allowedRoles) {
      user = await authRepository.findUserByEmail(email, r);
      if (user) break;
    }
    if (!user || !user.password_hash) {
      authLoginsTotal.inc({ role: 'unknown', outcome: 'wrong_password' });
      throw new InvalidCredentialsError();
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      authLoginsTotal.inc({ role: user.role, outcome: 'wrong_password' });
      throw new InvalidCredentialsError();
    }

    // The lookup already filtered by audience, so this is now a noop in
    // happy path — kept for defense-in-depth against any future code path
    // that bypasses the scoped finder.
    ensureRoleForAudience(user.role, audience);

    const profileId = await authRepository.resolveProfileId(user.id, user.role);
    const vendorType = resolveVendorType(user.role);

    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      tenantId: profileId,
      vendorType,
      profileId,
      tokenVersion: user.refresh_token_version,
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      tokenVersion: user.refresh_token_version,
    });

    authLoginsTotal.inc({ role: user.role, outcome: 'success' });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone_number: user.phone_number,
        role: user.role,
        profile_id: profileId,
      },
    };
  },

  // ── AUTH-05: Refresh Token ──

  async refreshAccessToken(refreshTokenStr: string, audience: AudienceKey): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    try {
      const decoded = jwt.verify(refreshTokenStr, env.JWT_SECRET) as {
        sub: string;
        rtv: number;
        type: string;
      };

      if (decoded.type !== 'refresh') {
        throw new TokenInvalidError();
      }

      const user = await authRepository.findUserById(decoded.sub);
      if (!user) throw new TokenInvalidError();

      if (user.refresh_token_version !== decoded.rtv) {
        throw new TokenInvalidError();
      }

      ensureRoleForAudience(user.role, audience);

      const profileId = await authRepository.resolveProfileId(user.id, user.role);
      const vendorType = resolveVendorType(user.role);

      const newVersion = await authRepository.incrementTokenVersion(user.id);

      const accessToken = generateAccessToken({
        userId: user.id,
        role: user.role,
        tenantId: profileId,
        vendorType,
        profileId,
        tokenVersion: newVersion,
      });

      const newRefreshToken = generateRefreshToken({
        userId: user.id,
        tokenVersion: newVersion,
      });

      return { access_token: accessToken, refresh_token: newRefreshToken };
    } catch (error) {
      if (error instanceof TokenInvalidError) throw error;
      if (error instanceof RoleMismatchError) throw error;
      throw new TokenInvalidError();
    }
  },

  // ── AUTH-06: Get My Profile ──

  async getProfile(userId: string, role: UserRole): Promise<Record<string, unknown>> {
    const [user, defaultAddr] = await Promise.all([
      authRepository.findUserById(userId),
      getDefaultAddress(userId),
    ]);
    if (!user) throw new ResourceNotFoundError('User');

    let profile: Record<string, unknown> = {
      id: user.id,
      email: user.email,
      phone_number: user.phone_number,
      role: user.role,
      is_email_verified: user.is_email_verified,
      created_at: user.created_at,
      default_address: defaultAddr
        ? {
            id:             defaultAddr.id,
            label:          defaultAddr.label,
            address_line1:  defaultAddr.address_line1,
            address_line2:  defaultAddr.address_line2,
            landmark:       defaultAddr.landmark,
            city:           defaultAddr.city,
            state:          defaultAddr.state,
            postal_code:    defaultAddr.postal_code,
            country_code:   defaultAddr.country_code,
            latitude:       defaultAddr.latitude,
            longitude:      defaultAddr.longitude,
          }
        : null,
    };

    switch (role) {
      case 'customer': {
        const cp = await authRepository.findCustomerProfile(userId);
        if (cp) {
          profile = {
            ...profile,
            profile_id: cp.id,
            first_name: cp.first_name,
            last_name: cp.last_name,
            avatar_url: cp.avatar_url,
            date_of_birth: cp.date_of_birth,
            gender_preference: cp.gender_preference,
            marketing_opt_in: cp.marketing_opt_in,
            total_completed_bookings: cp.total_completed_bookings,
            loyalty_points: cp.loyalty_points,
            service_code: cp.service_code,
          };
        }
        break;
      }
      case 'freelancer': {
        const fp = await authRepository.findFreelancerProfile(userId);
        if (fp) {
          profile = {
            ...profile,
            profile_id: fp.id,
            business_name: fp.business_name,
            bio: fp.bio,
            is_verified: fp.is_verified,
            commission_rate: Number(fp.commission_rate),
            average_rating: Number(fp.average_rating),
            total_reviews: fp.total_reviews,
          };
          // Append KYC + plan status for vendor roles.
          const kycStatus = await getKycStatus('freelancer', fp.id).catch(() => null);
          profile = {
            ...profile,
            kyc: kycStatus
              ? {
                  status:           kycStatus.status,
                  submission_id:    kycStatus.submission?.id ?? null,
                  rejection_reason: kycStatus.submission?.rejection_reason ?? null,
                }
              : null,
            plan: kycStatus?.plan ?? null,
          };
        }
        break;
      }
      case 'business_admin': {
        const ba = await authRepository.findBusinessAccount(userId);
        if (ba) {
          profile = {
            ...profile,
            profile_id: ba.id,
            legal_business_name: ba.legal_business_name,
            is_active: ba.is_active,
          };
          // Append KYC + plan status for vendor roles (use businessId as vendorId).
          const kycStatus = await getKycStatus('salon_location', ba.id).catch(() => null);
          profile = {
            ...profile,
            kyc: kycStatus
              ? {
                  status:           kycStatus.status,
                  submission_id:    kycStatus.submission?.id ?? null,
                  rejection_reason: kycStatus.submission?.rejection_reason ?? null,
                }
              : null,
            plan: kycStatus?.plan ?? null,
          };
        }
        break;
      }
    }

    return profile;
  },

  // ── AUTH-07: Update Profile ──

  async updateProfile(userId: string, role: UserRole, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (role) {
      case 'customer': {
        const customerFields: Record<string, unknown> = {};
        if (data.first_name !== undefined) customerFields.first_name = data.first_name;
        if (data.last_name !== undefined) customerFields.last_name = data.last_name;
        if (data.avatar_url !== undefined) customerFields.avatar_url = data.avatar_url;
        if (data.date_of_birth !== undefined) customerFields.date_of_birth = data.date_of_birth;
        if (data.gender_preference !== undefined) customerFields.gender_preference = data.gender_preference;
        if (data.marketing_opt_in !== undefined) customerFields.marketing_opt_in = data.marketing_opt_in;
        await authRepository.updateCustomerProfile(userId, customerFields);
        break;
      }
      case 'freelancer': {
        const freelancerFields: Record<string, unknown> = {};
        if (data.business_name !== undefined) freelancerFields.business_name = data.business_name;
        if (data.bio !== undefined) freelancerFields.bio = data.bio;
        await authRepository.updateFreelancerProfile(userId, freelancerFields);
        break;
      }
    }

    return this.getProfile(userId, role);
  },

  // ── AUTH-09: Logout ──

  async logout(userId: string): Promise<void> {
    // Increment token version to invalidate all existing tokens
    await authRepository.incrementTokenVersion(userId);
  },

  /**
   * Authenticated password change. Verifies the caller's current password
   * (so a stolen access token alone can't rotate the credential), then
   * updates the hash and bumps the token version — that invalidates every
   * other active session and forces a fresh sign-in elsewhere.
   *
   * Returns nothing; the caller's current access token stays valid for
   * its original TTL since we don't sign out the active session.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await authRepository.findUserById(userId);
    if (!user || !user.password_hash) {
      // OAuth-only accounts have no password to verify against; surface
      // the same error message a wrong password would give to avoid
      // signalling whether the account exists.
      throw new InvalidCredentialsError();
    }
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) throw new InvalidCredentialsError();

    const newHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    await authRepository.updatePasswordHash(userId, newHash);
    // Invalidate all other sessions — the current request's token still
    // works because this endpoint doesn't re-issue it (the access token
    // is short-lived; the refresh cookie will be rejected on next refresh).
    await authRepository.incrementTokenVersion(userId);
    return { message: 'Password updated. Other sessions have been signed out.' };
  },

  async verifyFirebaseToken(params: {
    id_token: string;
    role?: UserRole;
    first_name?: string;
    last_name?: string;
    email?: string;
    business_name?: string;
    legal_business_name?: string;
    address_line1?: string;
    city?: string;
    postal_code?: string;
    outlet_type?: 'unisex' | 'men' | 'women';
    gstin?: string;
    trade_license?: string;
    is_signup?: boolean;
    lookup_only?: boolean;
    audience: AudienceKey;
  }): Promise<{
    access_token: string;
    refresh_token: string;
    user: Record<string, unknown>;
    is_new_user: boolean;
  }> {
    const otpProvider = getOtpProvider();
    let phoneNumber: string;
    try {
      ({ phoneNumber } = await otpProvider.verifyFirebaseToken(params.id_token));
    } catch {
      throw new InvalidOtpError();
    }

    // Audience-scoped lookup: roles are decoupled, so a freelancer signup
    // never sees a salon admin's user record for the same phone. The same
    // phone can legitimately exist multiple times in the users table — one
    // row per role — and each one is its own identity.
    const roleToCreate = params.role || 'customer';
    let user = await authRepository.findUserByPhone(phoneNumber, roleToCreate);
    let isNewUser = false;

    // Signup callers explicitly mark themselves; if a user already exists
    // FOR THIS AUDIENCE we refuse to silently merge into it. Other audiences
    // are intentionally invisible here — the user can still register
    // separately for them.
    if (user && params.is_signup) {
      throw new PhoneExistsError({ existingRole: user.role });
    }

    // Login callers (`lookup_only=true`) explicitly opt out of the
    // silent-auto-create fallback below. When no user exists for this
    // audience we surface AUTH_PHONE_NOT_REGISTERED so the dashboard can
    // route the user into the signup flow with the just-verified idToken
    // handoff. This is the contract the salon/freelancer LoginPages rely
    // on to avoid stamping placeholder accounts (synthetic emails, "My
    // Salon"/"My Business" names) when someone is signing in for the
    // first time.
    if (!user && params.lookup_only) {
      throw new PhoneNotRegisteredError({ audience: params.audience });
    }

    if (!user) {
      const sanitizedPhone = phoneNumber.replace(/\+/g, '');
      // Real email takes priority. The synthetic fallback is suffixed with
      // the role so different roles for the same phone don't collide on the
      // composite (email, role) index — each audience has its own
      // <phone>+<role>@phone.kshuri.com placeholder.
      const syntheticEmail = `${sanitizedPhone}+${roleToCreate}@${AUTO_PHONE_EMAIL_DOMAIN}`;
      const email = params.email?.trim().toLowerCase() || syntheticEmail;
      const passwordHash = '';
      const firstName = params.first_name || DEFAULT_PHONE_USER_FIRST_NAME;
      const lastName = params.last_name || '';

      let createResult;
      
      switch (roleToCreate) {
        case 'freelancer':
          createResult = await authRepository.createFreelancer({
            email, passwordHash, phoneNumber, firstName, lastName,
            businessName: params.business_name || 'My Business',
            addressLine1: params.address_line1,
            city: params.city,
            postalCode: params.postal_code,
            genderPreference: params.outlet_type,
          });
          await emitUserCreatedAudit(createResult.userId, 'freelancer', 'otp');
          break;
        case 'business_admin':
          createResult = await authRepository.createBusinessAdmin({
            email, passwordHash, phoneNumber, firstName, lastName,
            legalBusinessName: params.legal_business_name || 'My Salon',
            addressLine1: params.address_line1,
            city: params.city,
            postalCode: params.postal_code,
            genderPreference: params.outlet_type,
            gstin: params.gstin,
            tradeLicense: params.trade_license,
          });
          await emitUserCreatedAudit(createResult.userId, 'business_admin', 'otp');
          break;
        case 'event_manager':
          createResult = await authRepository.createEventManager({ email, passwordHash, phoneNumber, firstName, lastName });
          await emitUserCreatedAudit(createResult.userId, 'event_manager', 'otp');
          break;
        case 'customer':
        default:
          createResult = await authRepository.createCustomer({ email, passwordHash, phoneNumber, firstName, lastName });
          await emitUserCreatedAudit(createResult.userId, 'customer', 'otp');
          break;
      }

      user = await authRepository.findUserById(createResult.userId);
      isNewUser = true;
    }

    if (!user) throw new InvalidOtpError();

    // Server-authoritative audience guard — the dashboard requesting auth
    // declares its audience via the X-Kshuri-Audience header; the role
    // hint in `params.role` is informational only.
    ensureRoleForAudience(user.role, params.audience);

    const profileId = await authRepository.resolveProfileId(user.id, user.role);
    const vendorType = resolveVendorType(user.role);

    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      tenantId: profileId,
      vendorType,
      profileId,
      tokenVersion: user.refresh_token_version,
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      tokenVersion: user.refresh_token_version,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone_number: user.phone_number,
        role: user.role,
      },
      is_new_user: isNewUser,
    };
  },

  // ── AUTH-12: Send Verification Email ──

  async sendVerificationEmail(userId: string): Promise<{ message: string }> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw new ResourceNotFoundError('User');

    if (user.is_email_verified) {
      return { message: 'Email is already verified.' };
    }

    const token = crypto.randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    await authRepository.setEmailVerificationToken(userId, token, expiresAt);

    const verificationUrl = `${env.APP_URL}/api/v1/auth/verify-email?token=${token}`;
    const emailProvider = getEmailProvider();

    const firstName = user.email.split('@')[0] ?? 'there';
    await emailProvider.sendVerificationEmail({
      to: user.email,
      firstName,
      verificationUrl,
    });

    return { message: 'Verification email sent. Please check your inbox.' };
  },

  // ── AUTH-13: Verify Email Token ──

  async verifyEmailToken(token: string): Promise<{ message: string }> {
    const user = await authRepository.findUserByEmailVerificationToken(token);
    if (!user) {
      throw new TokenInvalidError();
    }

    await authRepository.clearEmailVerificationToken(user.id);

    return { message: 'Email verified successfully.' };
  },

  // ── AUTH-10: Google OAuth ──

  async authenticateWithGoogle(
    idToken: string,
    role: UserRole = 'customer',
    audience: AudienceKey,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    user: Record<string, unknown>;
    is_new_user: boolean;
  }> {
    try {
      const client = getGoogleClient();
      const ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new OAuthError('Invalid Google token payload.');
      }

      const { userId, profileId, isNewUser } = await authRepository.findOrCreateGoogleUser({
        email: payload.email,
        firstName: payload.given_name || 'User',
        lastName: payload.family_name || '',
        avatarUrl: payload.picture,
        role,
      });

      if (isNewUser) {
        await emitUserCreatedAudit(userId, role, 'oauth-google');
      }

      const user = await authRepository.findUserById(userId);
      if (!user) throw new OAuthError('Failed to create user.');

      // Server-authoritative audience guard. Whether the account already
      // existed (with possibly a different role) or was just created, the
      // role MUST be allowed for this dashboard before we issue tokens.
      ensureRoleForAudience(user.role, audience);

      // Mark email as verified (Google verified it)
      await authRepository.markEmailVerified(userId);

      const vendorType = resolveVendorType(user.role);

      const accessToken = generateAccessToken({
        userId: user.id,
        role: user.role,
        tenantId: profileId,
        vendorType,
        profileId,
        tokenVersion: user.refresh_token_version,
      });

      const refreshToken = generateRefreshToken({
        userId: user.id,
        tokenVersion: user.refresh_token_version,
      });

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          profile_id: profileId,
        },
        is_new_user: isNewUser,
      };
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      if (error instanceof RoleMismatchError) throw error;
      throw new OAuthError('Google authentication failed.');
    }
  },

  async getDocuments(userId: string) {
    return authRepository.getDocuments(userId);
  },

  async getBankDetails(userId: string) {
    return authRepository.getBankDetails(userId);
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await authRepository.findUserByEmail(email);
    if (user) {
      const { generateResetToken, hashResetToken } = await import('../../lib/password-reset');
      const token     = generateResetToken();
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await authRepository.insertPasswordResetToken(user.id, tokenHash, expiresAt);
      const resetUrl = `${env.APP_URL}/auth/reset-password?token=${token}`;
      const emailProvider = getEmailProvider();
      const firstName = user.email.split('@')[0] ?? 'there';
      await emailProvider.sendPasswordResetEmail({ to: user.email, firstName, resetUrl });
    }
    // Always return success — no user enumeration.
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  },

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const { hashResetToken } = await import('../../lib/password-reset');
    const tokenHash = hashResetToken(token);
    const row = await authRepository.findPasswordResetToken(tokenHash);
    if (!row) throw new TokenInvalidError();
    if (row.consumed_at) throw new TokenInvalidError();
    if (new Date(row.expires_at) <= new Date()) throw new TokenExpiredError();

    const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    await authRepository.updatePasswordHash(row.user_id, passwordHash);
    await authRepository.incrementTokenVersion(row.user_id);
    await authRepository.consumePasswordResetToken(tokenHash);
    return { message: 'Password reset successfully. Please log in.' };
  },
};
