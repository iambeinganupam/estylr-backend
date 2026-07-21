-- TYPE: schema
-- Down migration for 028_business_profile_v2.up.sql
-- Removes: instagram_url, youtube_url, years_in_business, certifications columns
--          from business_accounts table

ALTER TABLE public.business_accounts
  DROP COLUMN IF EXISTS certifications,
  DROP COLUMN IF EXISTS years_in_business,
  DROP COLUMN IF EXISTS youtube_url,
  DROP COLUMN IF EXISTS instagram_url;
