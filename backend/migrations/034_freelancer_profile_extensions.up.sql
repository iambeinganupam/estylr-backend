-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 034 — Freelancer Profile Extensions (years/hourly/availability/social)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds the columns the Portfolio page surfaces in the "Professional Details"
-- and "Social Links" cards. None of these is required for signup; they are
-- enrichment fields the freelancer fills in from the Portfolio editor.
--
-- Naming notes:
--   - `hourly_rate` is distinct from `starting_price` (which is the lowest-
--     priced service); hourly_rate is for time-based gigs (e.g. salon hires).
--   - `availability_summary` is a free-form human caption (e.g. "Mon–Sat 9–7")
--     that the UI displays on the public profile preview. The authoritative
--     working hours still live in `public.working_hours`; this is just a
--     short, freelancer-authored tagline.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.freelancer_profiles
  ADD COLUMN IF NOT EXISTS years_of_experience  INTEGER,
  ADD COLUMN IF NOT EXISTS hourly_rate          NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS availability_summary VARCHAR(100),
  ADD COLUMN IF NOT EXISTS instagram_url        VARCHAR(500),
  ADD COLUMN IF NOT EXISTS youtube_url          VARCHAR(500),
  ADD COLUMN IF NOT EXISTS website_url          VARCHAR(500);

ALTER TABLE public.freelancer_profiles
  DROP CONSTRAINT IF EXISTS freelancer_profiles_years_nonneg;
ALTER TABLE public.freelancer_profiles
  ADD CONSTRAINT freelancer_profiles_years_nonneg
  CHECK (years_of_experience IS NULL OR years_of_experience >= 0);

ALTER TABLE public.freelancer_profiles
  DROP CONSTRAINT IF EXISTS freelancer_profiles_hourly_nonneg;
ALTER TABLE public.freelancer_profiles
  ADD CONSTRAINT freelancer_profiles_hourly_nonneg
  CHECK (hourly_rate IS NULL OR hourly_rate >= 0);

COMMENT ON COLUMN public.freelancer_profiles.hourly_rate IS
  'Hourly rate for time-based gigs (e.g. salon assignments). Distinct from starting_price.';
COMMENT ON COLUMN public.freelancer_profiles.availability_summary IS
  'Freelancer-authored caption for the public profile (e.g. "Mon–Sat 9 AM – 7 PM"). Authoritative schedule lives in working_hours.';
