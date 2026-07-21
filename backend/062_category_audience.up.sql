-- ─────────────────────────────────────────────────────────────────────────────
-- 062 — service_categories.audience + grooming taxonomy seed
--
-- Adds an audience tag to support running grooming-first and wedding-first
-- portals from the same category table. Existing rows default to 'grooming';
-- legacy wedding categories are reclassified and deactivated below.
--
-- Semantics after this migration:
--   • audience = 'grooming'  → standard day-to-day grooming/beauty services
--   • audience = 'wedding'   → wedding-specific categories (kept but inactive
--                              in the grooming portal; reserved for future use)
--   • audience = 'both'      → relevant to both portals
--
-- The partial index targets only the global taxonomy (vendor_id IS NULL) for
-- the discovery layer's audience+active filtered queries.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.service_categories
  ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'grooming'
    CHECK (audience IN ('grooming', 'wedding', 'both'));

CREATE INDEX IF NOT EXISTS idx_service_categories_audience_active
  ON public.service_categories (audience, is_active, sort_order)
 WHERE vendor_id IS NULL;  -- only the global taxonomy

-- ── Seed: grooming taxonomy (idempotent on name) ────────────────────────────
INSERT INTO public.service_categories (parent_id, name, sort_order, is_active, audience)
SELECT NULL, name, sort_order, TRUE, 'grooming'
FROM (VALUES
  ('Hair',                       10),
  ('Makeup',                     20),
  ('Skin & Facial',              30),
  ('Spa & Massage',              40),
  ('Nails',                      50),
  ('Barber & Men''s Grooming',   60),
  ('Hair Removal',               70),
  ('Threading & Brows',          80)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_categories sc
  WHERE LOWER(sc.name) = LOWER(v.name) AND sc.vendor_id IS NULL
);

-- ── Reclassify legacy wedding categories ────────────────────────────────────
-- Only flips rows that exist. Missing names are silently skipped so the
-- migration is safe in fresh + partial databases.
UPDATE public.service_categories
   SET audience = 'wedding',
       is_active = FALSE
 WHERE vendor_id IS NULL
   AND name IN (
     'Mehndi Artist',
     'Tent & Decoration',
     'Catering / Halwai',
     'Wedding Venues',
     'Event Managers',
     'Bridal Makeup',
     'Bridal Hair',
     'Wedding Photography',
     'Wedding Decoration'
   );
