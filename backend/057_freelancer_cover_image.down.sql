-- 057_freelancer_cover_image.down.sql
ALTER TABLE public.freelancer_profiles
  DROP COLUMN IF EXISTS cover_image_url;
