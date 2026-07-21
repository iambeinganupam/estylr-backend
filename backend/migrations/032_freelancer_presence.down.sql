-- TYPE: schema
-- Down migration for 032_freelancer_presence.up.sql
-- Removes: online_since_at column, freelancer_profiles_presence_consistency constraint,
--          and idx_freelancer_profiles_online_since index from freelancer_profiles

DROP INDEX IF EXISTS idx_freelancer_profiles_online_since;

ALTER TABLE public.freelancer_profiles
  DROP CONSTRAINT IF EXISTS freelancer_profiles_presence_consistency;

ALTER TABLE public.freelancer_profiles
  DROP COLUMN IF EXISTS online_since_at;
