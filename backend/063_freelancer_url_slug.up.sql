-- Migration 063: freelancer_profiles.url_slug
-- Mirrors salon_locations.url_slug (which already exists from migration 003)
-- so customer-facing /vendors/[slug] URLs resolve consistently across vendor
-- types.

ALTER TABLE public.freelancer_profiles
  ADD COLUMN IF NOT EXISTS url_slug VARCHAR(255);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- For each row missing a slug, derive one from business_name. On collision
-- (within freelancer_profiles), append the first 8 chars of the UUID.
UPDATE public.freelancer_profiles
   SET url_slug = base
  FROM (
    SELECT id,
           LOWER(REGEXP_REPLACE(
             REGEXP_REPLACE(business_name, '[^a-zA-Z0-9]+', '-', 'g'),
             '(^-|-$)', '', 'g'
           )) AS base
    FROM public.freelancer_profiles
    WHERE url_slug IS NULL
  ) AS gen
 WHERE public.freelancer_profiles.id = gen.id;

-- Resolve collisions by suffixing the first 8 chars of the row's id.
UPDATE public.freelancer_profiles fp
   SET url_slug = fp.url_slug || '-' || SUBSTRING(fp.id::text, 1, 8)
 WHERE fp.id IN (
   SELECT id FROM (
     SELECT id, url_slug,
            ROW_NUMBER() OVER (PARTITION BY url_slug ORDER BY created_at) AS rn
       FROM public.freelancer_profiles
   ) ranked
   WHERE rn > 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS freelancer_profiles_url_slug_uniq
  ON public.freelancer_profiles (url_slug)
  WHERE url_slug IS NOT NULL;
