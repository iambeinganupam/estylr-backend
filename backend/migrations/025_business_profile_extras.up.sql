-- Migration 025: business profile extras (tagline, specializations, languages)
-- Customer-facing salon profile fields surfaced on the Salon Dashboard
-- /portfolio page. specializations & languages are short string lists
-- (free-text for now; can be promoted to FK references once admin-managed
-- taxonomies stabilise).
ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS tagline         VARCHAR(160),
  ADD COLUMN IF NOT EXISTS specializations TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages       TEXT[] NOT NULL DEFAULT '{}';
