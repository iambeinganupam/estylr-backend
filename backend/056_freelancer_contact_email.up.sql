-- ─────────────────────────────────────────────────────────────────────────────
-- 056_freelancer_contact_email.up.sql
--
-- Adds a `contact_email` column to freelancer_profiles so a freelancer can
-- publish a real contact email separately from their `users.email`
-- identity. Phone-auth signups receive a synthetic `<phone>+<role>@phone
-- .kshuri.com` placeholder on the users row; we never want to surface that
-- to customers — `contact_email` is the field they actually fill in on the
-- Portfolio Edit page (mirrors business_accounts.contact_email).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.freelancer_profiles
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);

-- Light index for admin lookups; not unique because we don't want to block
-- a freelancer from reusing a salon's published email or vice-versa.
CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_contact_email
  ON public.freelancer_profiles (lower(contact_email))
  WHERE contact_email IS NOT NULL;
