-- TYPE: schema
-- Down migration for 014_email_verification.up.sql
-- Removes: email_verification_token, email_verification_expires_at columns
--          and related index from users table

DROP INDEX IF EXISTS idx_users_email_verification_token;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS email_verification_expires_at,
  DROP COLUMN IF EXISTS email_verification_token;
