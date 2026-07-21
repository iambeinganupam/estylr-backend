-- Migration 062 (down): revert audience column and grooming-taxonomy seeds.
--
-- Reversal order:
--   1. Restore is_active for the 9 wedding rows reclassified by the UP.
--   2. Delete only the grooming-taxonomy rows that 062 introduced for the
--      first time. The 3 names that overlap with 058's seed (Hair, Makeup,
--      Nails) are intentionally excluded — 058 owns them and they must survive
--      this rollback.
--   3. Drop the partial index, then the audience column.

-- ── 1. Restore wedding rows deactivated by 062 ──────────────────────────────
UPDATE public.service_categories
   SET is_active = TRUE
 WHERE vendor_id IS NULL
   AND audience = 'wedding'
   AND name IN (
     'Mehndi Artist', 'Tent & Decoration', 'Catering / Halwai',
     'Wedding Venues', 'Event Managers', 'Bridal Makeup',
     'Bridal Hair', 'Wedding Photography', 'Wedding Decoration'
   );

-- ── 2. Remove only the rows 062 inserted (not already owned by 058) ─────────
-- 058 seeds: Hair, Beard, Skin, Nails, Spa, Makeup, Massage, Bridal
-- 062 seeds: Hair(*), Makeup(*), Skin & Facial, Spa & Massage, Nails(*),
--            Barber & Men's Grooming, Hair Removal, Threading & Brows
-- (*) overlap — 058 owns these; leave them in place.
DELETE FROM public.service_categories
 WHERE vendor_id IS NULL
   AND name IN (
     'Skin & Facial',
     'Spa & Massage',
     'Barber & Men''s Grooming',
     'Hair Removal',
     'Threading & Brows'
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.services s WHERE s.category_id = public.service_categories.id
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.service_categories child
      WHERE child.parent_id = public.service_categories.id
   );

-- ── 3. Drop index and column ─────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_service_categories_audience_active;
ALTER TABLE public.service_categories DROP COLUMN IF EXISTS audience;
