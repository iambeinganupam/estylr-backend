// ─────────────────────────────────────────────────────────────────────────────
// Auth Module — Repository Layer
// ─────────────────────────────────────────────────────────────────────────────
// All database queries for authentication and user management.
// No business logic — just data access.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne, withTransaction } from '../../config/database';
import { UserRole } from '../../lib/constants';
import { generateServiceCode } from '../../lib/service-code';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';
import { assignUniqueSlug } from '../../lib/slug';
import { PoolClient } from 'pg';

// ── Types ──

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  phone_number: string | null;
  role: UserRole;
  refresh_token_version: number;
  is_email_verified: boolean;
  created_at: string;
  deleted_at: string | null;
}

interface CustomerProfileRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  date_of_birth: string | null;
  gender_preference: string;
  marketing_opt_in: boolean;
  total_completed_bookings: number;
  loyalty_points: number;
  service_code: string;
  service_code_issued_at: string | null;
}

interface FreelancerProfileRow {
  id: string;
  user_id: string;
  business_name: string;
  bio: string | null;
  is_verified: boolean;
  commission_rate: string;
  average_rating: string;
  total_reviews: number;
}

interface BusinessAccountRow {
  id: string;
  owner_user_id: string;
  legal_business_name: string;
  is_active: boolean;
}

export const authRepository = {
  // ── User CRUD ──

  /**
   * Look up a user by email. Audience-scoped when `role` is provided — see
   * the long-form rationale on findUserByPhone(). For login by email
   * (LoginPage password tab) we still pass the audience role so a
   * salon-admin email isn't picked up when signing into the freelancer
   * dashboard.
   */
  async findUserByEmail(email: string, role?: string): Promise<UserRow | null> {
    if (role) {
      return queryOne<UserRow>(
        'SELECT * FROM public.users WHERE email = $1 AND role = $2 AND deleted_at IS NULL',
        [email, role],
      );
    }
    return queryOne<UserRow>(
      'SELECT * FROM public.users WHERE email = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1',
      [email],
    );
  },

  /**
   * Look up a user by phone — audience-scoped when `role` is provided.
   *
   * Kshuri's identity model decouples roles: the same phone can have one
   * `business_admin` record, one `freelancer` record, one `customer` record,
   * etc., each with no cross-visibility. Callers that know which audience
   * they're operating in MUST pass `role` so they only see their own slice.
   *
   * The legacy un-scoped lookup (no role) is kept for one-off admin tooling
   * (super-admin user search). Returns the oldest matching user when several
   * exist across roles.
   */
  async findUserByPhone(phoneNumber: string, role?: string): Promise<UserRow | null> {
    if (role) {
      return queryOne<UserRow>(
        'SELECT * FROM public.users WHERE phone_number = $1 AND role = $2 AND deleted_at IS NULL',
        [phoneNumber, role],
      );
    }
    return queryOne<UserRow>(
      'SELECT * FROM public.users WHERE phone_number = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1',
      [phoneNumber],
    );
  },

  async findUserById(userId: string): Promise<UserRow | null> {
    return queryOne<UserRow>(
      'SELECT * FROM public.users WHERE id = $1 AND deleted_at IS NULL',
      [userId],
    );
  },

  // ── Registration (transactional) ──

  async createCustomer(params: {
    email: string;
    passwordHash: string;
    phoneNumber?: string;
    firstName: string;
    lastName: string;
  }): Promise<{ userId: string; profileId: string }> {
    return withTransaction(async (client: PoolClient) => {
      try {
        // 1. Create users row. Name lives on `users` for all roles so the
        // admin/KYC queue and any cross-role lookup can render it without
        // joining each role's profile table.
        const userResult = await client.query<{ id: string }>(
          `INSERT INTO public.users (email, password_hash, phone_number, role, first_name, last_name)
           VALUES ($1, $2, $3, 'customer', $4, $5)
           RETURNING id`,
          [
            params.email,
            params.passwordHash,
            params.phoneNumber || null,
            params.firstName || null,
            params.lastName || null,
          ],
        );
        const userId = userResult.rows[0]!.id;

        // 2. Create customer_profiles row (PK is user_id, no separate id column)
        // service_code is NOT NULL — generate a 6-digit code at signup
        // using the weak-pattern-filtered utility.
        const serviceCode = generateServiceCode();
        const profileResult = await client.query<{ id: string }>(
          `INSERT INTO public.customer_profiles (user_id, first_name, last_name, service_code, service_code_issued_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING user_id AS id`,
          [userId, params.firstName, params.lastName, serviceCode],
        );

        return { userId, profileId: profileResult.rows[0]!.id };
      } catch (e) { mapPgError(e); }
    });
  },

  async createFreelancer(params: {
    email: string;
    passwordHash: string;
    phoneNumber?: string;
    firstName: string;
    lastName: string;
    businessName: string;
    addressLine1?: string;
    city?: string;
    postalCode?: string;
    genderPreference?: 'unisex' | 'men' | 'women';
  }): Promise<{ userId: string; profileId: string }> {
    return withTransaction(async (client: PoolClient) => {
      try {
        const userResult = await client.query<{ id: string }>(
          `INSERT INTO public.users (email, password_hash, phone_number, role, first_name, last_name)
           VALUES ($1, $2, $3, 'freelancer', $4, $5)
           RETURNING id`,
          [
            params.email,
            params.passwordHash,
            params.phoneNumber || null,
            params.firstName || null,
            params.lastName || null,
          ],
        );
        const userId = userResult.rows[0]!.id;

        const profileResult = await client.query<{ id: string }>(
          `INSERT INTO public.freelancer_profiles
             (user_id, business_name, address_line1, city, postal_code, gender_preference)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            userId,
            params.businessName,
            params.addressLine1 || null,
            params.city || null,
            params.postalCode || null,
            params.genderPreference || null,
          ],
        );
        const profileId = profileResult.rows[0]!.id;

        // Assign a public `url_slug` so the vendor can be shared immediately.
        // Collision-safe: bare slug for the common case, UUID-suffixed on
        // conflict — see `lib/slug.ts` for the rationale.
        await assignUniqueSlug(client, 'freelancer_profiles', profileId, params.businessName);

        return { userId, profileId };
      } catch (e) { mapPgError(e); }
    });
  },

  async createBusinessAdmin(params: {
    email: string;
    passwordHash: string;
    phoneNumber?: string;
    firstName: string;
    lastName: string;
    legalBusinessName: string;
    addressLine1?: string;
    city?: string;
    postalCode?: string;
    genderPreference?: 'unisex' | 'men' | 'women';
    gstin?: string;
    tradeLicense?: string;
  }): Promise<{ userId: string; profileId: string }> {
    return withTransaction(async (client: PoolClient) => {
      try {
        const userResult = await client.query<{ id: string }>(
          `INSERT INTO public.users (email, password_hash, phone_number, role, first_name, last_name)
           VALUES ($1, $2, $3, 'business_admin', $4, $5)
           RETURNING id`,
          [
            params.email,
            params.passwordHash,
            params.phoneNumber || null,
            params.firstName || null,
            params.lastName || null,
          ],
        );
        const userId = userResult.rows[0]!.id;

        const businessResult = await client.query<{ id: string }>(
          `INSERT INTO public.business_accounts
             (owner_user_id, legal_business_name, gstin, trade_license)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [
            userId,
            params.legalBusinessName,
            params.gstin || null,
            params.tradeLicense || null,
          ],
        );
        const businessAccountId = businessResult.rows[0]!.id;

        // Outlet address goes on salon_locations — business_accounts holds only
        // legal entity info. We always create at least one default location at
        // signup so the vendor has somewhere to attach services + bookings.
        const locationResult = await client.query<{ id: string }>(
          `INSERT INTO public.salon_locations
             (business_account_id, display_name, address_line1, city, postal_code, gender_preference)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            businessAccountId,
            params.legalBusinessName,
            params.addressLine1 || null,
            params.city || null,
            params.postalCode || null,
            params.genderPreference || null,
          ],
        );
        const locationId = locationResult.rows[0]!.id;

        // Assign a public `url_slug` to the primary location so the vendor's
        // /vendors/{slug} URL is shareable immediately on signup. Collision-
        // safe: bare slug first, UUID-suffixed on conflict.
        await assignUniqueSlug(client, 'salon_locations', locationId, params.legalBusinessName);

        return { userId, profileId: businessAccountId };
      } catch (e) { mapPgError(e); }
    });
  },

  async createEventManager(params: {
    email: string;
    passwordHash: string;
    phoneNumber?: string;
    firstName: string;
    lastName: string;
  }): Promise<{ userId: string; profileId: string }> {
    return withTransaction(async (client: PoolClient) => {
      try {
        const userResult = await client.query<{ id: string }>(
          `INSERT INTO public.users (email, password_hash, phone_number, role, first_name, last_name)
           VALUES ($1, $2, $3, 'event_manager', $4, $5)
           RETURNING id`,
          [
            params.email,
            params.passwordHash,
            params.phoneNumber || null,
            params.firstName || null,
            params.lastName || null,
          ],
        );
        const userId = userResult.rows[0]!.id;
        return { userId, profileId: userId };
      } catch (e) { mapPgError(e); }
    });
  },

  // ── Profile Queries ──

  async findCustomerProfile(userId: string): Promise<CustomerProfileRow | null> {
    return queryOne<CustomerProfileRow>(
      'SELECT * FROM public.customer_profiles WHERE user_id = $1',
      [userId],
    );
  },

  async findFreelancerProfile(userId: string): Promise<FreelancerProfileRow | null> {
    return queryOne<FreelancerProfileRow>(
      'SELECT * FROM public.freelancer_profiles WHERE user_id = $1',
      [userId],
    );
  },

  async findBusinessAccount(userId: string): Promise<BusinessAccountRow | null> {
    return queryOne<BusinessAccountRow>(
      'SELECT * FROM public.business_accounts WHERE owner_user_id = $1',
      [userId],
    );
  },

  // ── Profile Updates ──

  // Columns a customer can legitimately update via AUTH-07.
  // Excludes: id, user_id, service_code, service_code_issued_at, created_at,
  //           total_completed_bookings, loyalty_points (system-managed counters).
  async updateCustomerProfile(userId: string, fields: Record<string, unknown>): Promise<void> {
    const ALLOWED_FIELDS = [
      'first_name', 'last_name', 'avatar_url', 'date_of_birth',
      'gender_preference', 'marketing_opt_in',
    ] as const;
    const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS);
    try {
      await query(
        `UPDATE public.customer_profiles SET ${setClause} WHERE user_id = $1`,
        [userId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  // Columns a freelancer can update via AUTH-07.
  // Excludes: id, user_id, is_verified, commission_rate, average_rating,
  //           total_reviews (system-managed or admin-set).
  async updateFreelancerProfile(userId: string, fields: Record<string, unknown>): Promise<void> {
    const ALLOWED_FIELDS = ['business_name', 'bio'] as const;
    const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS);
    try {
      await query(
        `UPDATE public.freelancer_profiles SET ${setClause} WHERE user_id = $1`,
        [userId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Token Version ──

  async incrementTokenVersion(userId: string): Promise<number> {
    try {
      const result = await queryOne<{ refresh_token_version: number }>(
        `UPDATE public.users SET refresh_token_version = refresh_token_version + 1
         WHERE id = $1 RETURNING refresh_token_version`,
        [userId],
      );
      return result?.refresh_token_version ?? 1;
    } catch (e) { mapPgError(e); }
  },

  // ── OTP Codes (Postgres-backed) ──

  async upsertOtp(phoneNumber: string, codeHash: string, ttlMs = 300000): Promise<void> {
    try {
      await query(
        `INSERT INTO public.otp_codes (phone_number, code_hash, expires_at, attempts, last_attempt_at)
         VALUES ($1, $2, NOW() + ($3::INT * INTERVAL '1 millisecond'), 0, NULL)
         ON CONFLICT (phone_number) DO UPDATE
            SET code_hash       = EXCLUDED.code_hash,
                expires_at      = EXCLUDED.expires_at,
                attempts        = 0,
                last_attempt_at = NULL,
                created_at      = NOW()`,
        [phoneNumber, codeHash, ttlMs],
      );
    } catch (e) { mapPgError(e); }
  },

  async findOtp(phoneNumber: string): Promise<{ code_hash: string; expires_at: string; attempts: number } | null> {
    return queryOne<{ code_hash: string; expires_at: string; attempts: number }>(
      `SELECT code_hash, expires_at, attempts FROM public.otp_codes WHERE phone_number = $1`,
      [phoneNumber],
    );
  },

  async recordOtpAttempt(phoneNumber: string): Promise<number> {
    try {
      const row = await queryOne<{ attempts: number }>(
        `UPDATE public.otp_codes
            SET attempts = attempts + 1,
                last_attempt_at = NOW()
          WHERE phone_number = $1
          RETURNING attempts`,
        [phoneNumber],
      );
      return row?.attempts ?? 0;
    } catch (e) { mapPgError(e); }
  },

  async deleteOtp(phoneNumber: string): Promise<void> {
    try {
      await query(`DELETE FROM public.otp_codes WHERE phone_number = $1`, [phoneNumber]);
    } catch (e) { mapPgError(e); }
  },

  // ── User by Google ID / Email for OAuth ──

  async findOrCreateGoogleUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    role: UserRole;
    businessName?: string;
    legalBusinessName?: string;
  }): Promise<{ userId: string; profileId: string; isNewUser: boolean }> {
    const existingUser = await this.findUserByEmail(params.email);
    if (existingUser) {
      const profileId = await this.resolveProfileId(existingUser.id, existingUser.role);
      return { userId: existingUser.id, profileId, isNewUser: false };
    }

    const common = {
      email: params.email,
      passwordHash: '', // OAuth users have no password
      firstName: params.firstName,
      lastName: params.lastName,
    };

    switch (params.role) {
      case 'customer': {
        const r = await this.createCustomer(common);
        return { ...r, isNewUser: true };
      }
      case 'freelancer': {
        const r = await this.createFreelancer({
          ...common,
          businessName: params.businessName ?? `${params.firstName} ${params.lastName}`.trim(),
        });
        return { ...r, isNewUser: true };
      }
      case 'business_admin': {
        const r = await this.createBusinessAdmin({
          ...common,
          legalBusinessName: params.legalBusinessName ?? `${params.firstName} ${params.lastName}`.trim(),
        });
        return { ...r, isNewUser: true };
      }
      case 'event_manager': {
        const r = await this.createEventManager(common);
        return { ...r, isNewUser: true };
      }
      // staff and super_admin are not provisioned via Google OAuth — fall back to customer.
      case 'staff':
      case 'super_admin':
      default: {
        const r = await this.createCustomer(common);
        return { ...r, isNewUser: true };
      }
    }
  },

  async resolveProfileId(userId: string, role: UserRole): Promise<string> {
    switch (role) {
      case 'customer': {
        const profile = await this.findCustomerProfile(userId);
        return profile?.id ?? userId;
      }
      case 'freelancer': {
        const profile = await this.findFreelancerProfile(userId);
        return profile?.id ?? userId;
      }
      case 'business_admin': {
        const account = await this.findBusinessAccount(userId);
        return account?.id ?? userId;
      }
      case 'staff':
      case 'event_manager':
      case 'super_admin':
        return userId;
      default:
        return userId;
    }
  },

  // ── Password Reset ──

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    try {
      await query(
        'UPDATE public.users SET password_hash = $1 WHERE id = $2',
        [passwordHash, userId],
      );
    } catch (e) { mapPgError(e); }
  },

  async markEmailVerified(userId: string): Promise<void> {
    try {
      await query(
        'UPDATE public.users SET is_email_verified = TRUE WHERE id = $1',
        [userId],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Email Verification Token ──

  async setEmailVerificationToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    try {
      await query(
        `UPDATE public.users
         SET email_verification_token = $1, email_verification_expires_at = $2
         WHERE id = $3`,
        [token, expiresAt, userId],
      );
    } catch (e) { mapPgError(e); }
  },

  async findUserByEmailVerificationToken(token: string): Promise<UserRow | null> {
    return queryOne<UserRow>(
      `SELECT * FROM public.users
       WHERE email_verification_token = $1
         AND email_verification_expires_at > NOW()
         AND deleted_at IS NULL`,
      [token],
    );
  },

  async clearEmailVerificationToken(userId: string): Promise<void> {
    try {
      await query(
        `UPDATE public.users
         SET is_email_verified = TRUE,
             email_verification_token = NULL,
             email_verification_expires_at = NULL
         WHERE id = $1`,
        [userId],
      );
    } catch (e) { mapPgError(e); }
  },

  async getDocuments(userId: string) {
    const fp = await queryOne<{ kyc_status: string }>(
      `SELECT kyc_status FROM public.freelancer_profiles WHERE user_id = $1`,
      [userId],
    );
    return fp ? [{ type: 'kyc', status: fp.kyc_status }] : [];
  },

  async getBankDetails(userId: string) {
    const result = await query(
      `SELECT ba.* FROM public.bank_accounts ba
       JOIN public.freelancer_profiles fp ON fp.id = ba.vendor_id
       WHERE fp.user_id = $1 AND ba.is_primary = TRUE
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async insertPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    try {
      await query(
        `INSERT INTO public.password_reset_tokens (token_hash, user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [tokenHash, userId, expiresAt],
      );
    } catch (e) { mapPgError(e); }
  },

  async findPasswordResetToken(tokenHash: string): Promise<{ user_id: string; expires_at: string; consumed_at: string | null } | null> {
    return queryOne<{ user_id: string; expires_at: string; consumed_at: string | null }>(
      `SELECT user_id, expires_at, consumed_at
         FROM public.password_reset_tokens
        WHERE token_hash = $1`,
      [tokenHash],
    );
  },

  async consumePasswordResetToken(tokenHash: string): Promise<void> {
    try {
      await query(
        `UPDATE public.password_reset_tokens
            SET consumed_at = NOW()
          WHERE token_hash = $1`,
        [tokenHash],
      );
    } catch (e) { mapPgError(e); }
  },
};
