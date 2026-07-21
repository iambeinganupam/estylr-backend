-- 056_freelancer_contact_email.down.sql
DROP INDEX IF EXISTS public.idx_freelancer_profiles_contact_email;
ALTER TABLE public.freelancer_profiles
  DROP COLUMN IF EXISTS contact_email;
