-- Migration 063 (down): remove url_slug + its unique index.
DROP INDEX IF EXISTS public.freelancer_profiles_url_slug_uniq;
ALTER TABLE public.freelancer_profiles DROP COLUMN IF EXISTS url_slug;
