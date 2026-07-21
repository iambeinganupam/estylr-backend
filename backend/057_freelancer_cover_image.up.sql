-- ─────────────────────────────────────────────────────────────────────────────
-- 057_freelancer_cover_image.up.sql
--
-- Adds a `cover_image_url` column to freelancer_profiles so freelancers can
-- publish a banner image on their public profile, matching the salon
-- experience (business_accounts.cover_image_url). `logo_url` already exists
-- on this table; we standardise on the same naming as business_accounts so
-- the Portfolio Edit page can reuse the same uploader.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.freelancer_profiles
  ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500);
