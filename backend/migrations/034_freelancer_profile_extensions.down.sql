-- TYPE: schema
-- Down migration for 034_freelancer_profile_extensions.up.sql
-- Removes: years_of_experience, hourly_rate, availability_summary, instagram_url,
--          youtube_url, website_url columns and associated constraints
--          from freelancer_profiles table

ALTER TABLE public.freelancer_profiles
  DROP CONSTRAINT IF EXISTS freelancer_profiles_hourly_nonneg;

ALTER TABLE public.freelancer_profiles
  DROP CONSTRAINT IF EXISTS freelancer_profiles_years_nonneg;

ALTER TABLE public.freelancer_profiles
  DROP COLUMN IF EXISTS website_url,
  DROP COLUMN IF EXISTS youtube_url,
  DROP COLUMN IF EXISTS instagram_url,
  DROP COLUMN IF EXISTS availability_summary,
  DROP COLUMN IF EXISTS hourly_rate,
  DROP COLUMN IF EXISTS years_of_experience;
