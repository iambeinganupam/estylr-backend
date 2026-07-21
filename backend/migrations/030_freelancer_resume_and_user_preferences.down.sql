-- TYPE: schema
-- Down migration for 030_freelancer_resume_and_user_preferences.up.sql
-- Removes: freelancer_experience, freelancer_skills, freelancer_certifications,
--          freelancer_languages, freelancer_salon_associations, user_preferences tables,
--          related indexes, triggers, and is_open_to_work column from freelancer_profiles

-- Remove is_open_to_work from freelancer_profiles
ALTER TABLE public.freelancer_profiles
  DROP COLUMN IF EXISTS is_open_to_work;

-- Drop triggers
DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON public.user_preferences;
DROP TRIGGER IF EXISTS trg_freelancer_experience_updated_at ON public.freelancer_experience;

-- Drop indexes
DROP INDEX IF EXISTS idx_freelancer_salon_associations_freelancer;
DROP INDEX IF EXISTS idx_freelancer_certifications_freelancer;
DROP INDEX IF EXISTS idx_freelancer_skills_freelancer;
DROP INDEX IF EXISTS idx_freelancer_experience_freelancer;

-- Drop tables (order matters for FK dependencies)
DROP TABLE IF EXISTS public.user_preferences CASCADE;
DROP TABLE IF EXISTS public.freelancer_salon_associations CASCADE;
DROP TABLE IF EXISTS public.freelancer_languages CASCADE;
DROP TABLE IF EXISTS public.freelancer_certifications CASCADE;
DROP TABLE IF EXISTS public.freelancer_skills CASCADE;
DROP TABLE IF EXISTS public.freelancer_experience CASCADE;
