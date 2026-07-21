-- TYPE: schema
-- Down migration for 002_users_and_auth.up.sql
-- Removes: users table, otp_tokens table, customer_profiles table,
--          update_updated_at function, related triggers, indexes,
--          user_role enum, auth_provider enum

DROP TRIGGER IF EXISTS trg_customer_profiles_updated_at ON public.customer_profiles;
DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;

DROP INDEX IF EXISTS idx_otp_phone_expires;
DROP INDEX IF EXISTS idx_users_google_sub;
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_phone;
DROP INDEX IF EXISTS idx_users_email;

DROP TABLE IF EXISTS public.customer_profiles CASCADE;
DROP TABLE IF EXISTS public.otp_tokens CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

DROP TYPE IF EXISTS auth_provider;
DROP TYPE IF EXISTS user_role;
