-- Migration 026: trending / featured flags on services
-- Surfaces curated subsets in the salon-dashboard /portfolio public preview
-- (Trending Services, Featured Services). Both default to FALSE so existing
-- services are unaffected; vendors opt-in via the Edit Profile UI.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS is_trending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
