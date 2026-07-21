-- TYPE: schema
-- Down migration for 025_business_profile_extras.up.sql
-- Removes: tagline, specializations, languages columns from business_accounts table

ALTER TABLE public.business_accounts
  DROP COLUMN IF EXISTS languages,
  DROP COLUMN IF EXISTS specializations,
  DROP COLUMN IF EXISTS tagline;
