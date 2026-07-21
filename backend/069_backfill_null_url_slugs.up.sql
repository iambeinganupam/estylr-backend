-- Migration 069: backfill NULL url_slug across freelancer_profiles + salon_locations.
--
-- Earlier migration 063 backfilled freelancer slugs once, but the runtime
-- signup paths didn't auto-generate slugs — so any vendor created between
-- then and now still has `url_slug = NULL` and renders the Share button as
-- disabled. This migration is idempotent: it only touches rows where the
-- slug is currently NULL, and it follows the same convention as 063
-- (kebab-case base; UUID-prefix suffix on collision).

-- ── freelancer_profiles ─────────────────────────────────────────────────────
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
 WHERE public.freelancer_profiles.id = gen.id
   AND public.freelancer_profiles.url_slug IS NULL;

-- Resolve collisions in the freshly-written rows by suffixing the first
-- 8 chars of the row's UUID (mirrors migration 063).
UPDATE public.freelancer_profiles fp
   SET url_slug = fp.url_slug || '-' || SUBSTRING(REPLACE(fp.id::text, '-', ''), 1, 8)
 WHERE fp.id IN (
   SELECT id FROM (
     SELECT id, url_slug,
            ROW_NUMBER() OVER (PARTITION BY url_slug ORDER BY created_at) AS rn
       FROM public.freelancer_profiles
       WHERE url_slug IS NOT NULL
   ) ranked
   WHERE rn > 1
 );

-- ── salon_locations ─────────────────────────────────────────────────────────
-- Column has been present + UNIQUE since migration 003, but never backfilled.
UPDATE public.salon_locations
   SET url_slug = base
  FROM (
    SELECT id,
           LOWER(REGEXP_REPLACE(
             REGEXP_REPLACE(display_name, '[^a-zA-Z0-9]+', '-', 'g'),
             '(^-|-$)', '', 'g'
           )) AS base
    FROM public.salon_locations
    WHERE url_slug IS NULL
  ) AS gen
 WHERE public.salon_locations.id = gen.id
   AND public.salon_locations.url_slug IS NULL;

UPDATE public.salon_locations sl
   SET url_slug = sl.url_slug || '-' || SUBSTRING(REPLACE(sl.id::text, '-', ''), 1, 8)
 WHERE sl.id IN (
   SELECT id FROM (
     SELECT id, url_slug,
            ROW_NUMBER() OVER (PARTITION BY url_slug ORDER BY created_at) AS rn
       FROM public.salon_locations
       WHERE url_slug IS NOT NULL
   ) ranked
   WHERE rn > 1
 );
