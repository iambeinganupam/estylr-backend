-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 014_email_verification
-- Description: Add email verification token columns to users table
-- ─────────────────────────────────────────────────────────────────────────────
-- auth.service.ts uses these columns for the send-verification-email +
-- verify-email flow. Tokens are single-use, time-limited, and cleared on use.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verification_token TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_verification_token
  ON public.users(email_verification_token)
  WHERE email_verification_token IS NOT NULL;
