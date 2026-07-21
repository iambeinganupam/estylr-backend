// ─────────────────────────────────────────────────────────────────────────────
// Auth Module — Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

// ── AUTH-01: Request OTP ──
export const requestOtpSchema = z.object({
  phone_number: z.string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be in E.164 format (e.g., +919876543210)'),
});

// ── AUTH-02: Verify OTP ──
export const verifyOtpSchema = z.object({
  phone_number: z.string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be in E.164 format'),
  otp_code: z.string().length(6, 'OTP must be exactly 6 digits'),
});

// ── AUTH-03: Register ──
export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['customer', 'freelancer', 'business_admin', 'event_manager']),
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone_number: z.string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be in E.164 format')
    .optional(),
  business_name: z.string().max(100).optional(),
  legal_business_name: z.string().max(255).optional(),
}).refine((data) => {
  // Freelancers must provide business_name
  if (data.role === 'freelancer' && !data.business_name) {
    return false;
  }
  return true;
}, {
  message: 'Business name is required for freelancer registration',
  path: ['business_name'],
}).refine((data) => {
  // Business admins must provide legal_business_name
  if (data.role === 'business_admin' && !data.legal_business_name) {
    return false;
  }
  return true;
}, {
  message: 'Legal business name is required for business admin registration',
  path: ['legal_business_name'],
});

// ── AUTH-04: Login ──
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// ── AUTH-05: Refresh Token ──
export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

// ── AUTH-07: Update Profile ──
export const updateProfileSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().max(500).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
  gender_preference: z.enum(['male', 'female', 'unisex', 'no_preference']).optional(),
  marketing_opt_in: z.boolean().optional(),
  bio: z.string().max(500).optional(),
  business_name: z.string().max(100).optional(),
});

// ── AUTH-08: Forgot / Reset Password ──
export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

// ── AUTH-08c: Change password (authenticated session) ──
// In-app password update for the signed-in user. Requires the current
// password as a knowledge proof so a stolen access token alone can't
// rotate the password.
export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password is too long'),
}).refine((b) => b.current_password !== b.new_password, {
  message: 'New password must be different from the current password',
  path: ['new_password'],
});

// ── AUTH-10: Google OAuth ──
export const oauthGoogleSchema = z.object({
  id_token: z.string().min(1, 'Google ID token is required'),
  // event_manager requires email/password registration; OAuth only supports these 3 roles
  role: z.enum(['customer', 'freelancer', 'business_admin']).optional().default('customer'),
});

// ── AUTH-11: Verify Firebase Phone Token ──
export const verifyFirebaseTokenSchema = z.object({
  id_token: z.string().min(1, 'Firebase ID token is required'),
  role: z.enum(['customer', 'freelancer', 'business_admin', 'event_manager']).optional().default('customer'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().max(255).optional(),
  business_name: z.string().optional(),
  legal_business_name: z.string().optional(),
  // Outlet/address details — used when role is 'business_admin' or 'freelancer'
  // and persisted to salon_locations / freelancer_profiles respectively.
  address_line1: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  outlet_type: z.enum(['unisex', 'men', 'women']).optional(),
  // Optional business-document text fields persisted on business_accounts.
  gstin: z.string().max(50).optional(),
  trade_license: z.string().max(100).optional(),
  // Discriminator: signup pages send true, login pages send false/omit.
  // When true and a user with this phone already exists, the API returns
  // PHONE_ALREADY_REGISTERED instead of silently logging the caller in.
  is_signup: z.boolean().optional(),
  // Login-page discriminator: when true and no user exists for this
  // audience, the API returns AUTH_PHONE_NOT_REGISTERED instead of
  // auto-creating a placeholder account. The login page then routes the
  // user into the signup flow with the just-verified idToken so they
  // can finish onboarding with real details (real name, real email, real
  // business name) rather than landing on a synthetic placeholder.
  lookup_only: z.boolean().optional(),
});

// ── AUTH-12: Send Verification Email ──
export const sendVerificationEmailSchema = z.object({
  // empty body — user resolved from auth token
});

// ── AUTH-13: Verify Email Token ──
export const verifyEmailTokenSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});
