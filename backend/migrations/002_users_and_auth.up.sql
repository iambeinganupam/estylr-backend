-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 002_users_and_auth
-- Description: Core users table and auth infrastructure
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enum Types ──
CREATE TYPE user_role AS ENUM ('customer', 'freelancer', 'staff', 'business_admin', 'super_admin');
CREATE TYPE auth_provider AS ENUM ('email', 'phone', 'google', 'apple');

-- ── Users ──
CREATE TABLE public.users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   VARCHAR(255) UNIQUE,
  phone_number            VARCHAR(20) UNIQUE,
  password_hash           VARCHAR(255),
  role                    user_role NOT NULL,
  auth_provider           auth_provider NOT NULL DEFAULT 'email',
  google_sub              VARCHAR(255) UNIQUE,

  -- Auth security
  is_email_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  is_phone_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  refresh_token_version   INTEGER NOT NULL DEFAULT 1,

  -- Password reset
  reset_password_token    VARCHAR(255),
  reset_password_expires  TIMESTAMPTZ,

  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at           TIMESTAMPTZ,

  CONSTRAINT chk_email_or_phone CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);

-- ── OTP Tokens ──
CREATE TABLE public.otp_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number  VARCHAR(20) NOT NULL,
  otp_hash      VARCHAR(255) NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  is_used       BOOLEAN NOT NULL DEFAULT FALSE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Customer Profiles ──
CREATE TABLE public.customer_profiles (
  user_id                 UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  first_name              VARCHAR(100),
  last_name               VARCHAR(100),
  avatar_url              VARCHAR(500),
  date_of_birth           DATE,
  gender_preference       VARCHAR(20),
  marketing_opt_in        BOOLEAN NOT NULL DEFAULT FALSE,
  loyalty_points          INTEGER NOT NULL DEFAULT 0,
  total_completed_bookings INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON public.users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_phone_expires ON public.otp_tokens(phone_number, expires_at) WHERE is_used = FALSE;

-- ── Auto-Updated Timestamps Trigger ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_customer_profiles_updated_at BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
