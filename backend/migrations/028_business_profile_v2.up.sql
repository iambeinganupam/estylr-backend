-- Migration 028: Salon profile v2 — social presence, credibility, experience.
--
-- Drives feature parity with the customer-facing freelancer Portfolio page
-- and unblocks the Salon Dashboard's Edit Profile tab.
--
--  * instagram_url / youtube_url — public profile social links (website_url
--    already exists). VARCHAR(500) to match the URL fields convention.
--  * years_in_business — manual override. Computing experience from
--    `created_at` was wrong for salons that operated for years before joining
--    Kshuri. Bounded 0..200 as a sanity check.
--  * certifications — flexible JSONB array of { name, issuer, year, credential_id? }
--    objects. Kept as JSONB instead of a side table because (a) read pattern
--    is always alongside the profile and (b) v1 has no cross-vendor querying
--    over this data. Promote to a normalised `salon_certifications` table if
--    we later need verification workflows or admin moderation.
ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS instagram_url     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS youtube_url       VARCHAR(500),
  ADD COLUMN IF NOT EXISTS years_in_business INTEGER
    CHECK (years_in_business IS NULL OR (years_in_business >= 0 AND years_in_business <= 200)),
  ADD COLUMN IF NOT EXISTS certifications    JSONB NOT NULL DEFAULT '[]'::jsonb;
