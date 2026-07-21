-- ─────────────────────────────────────────────────────────────────────────────
-- 060 — Consolidate the "Bridal" / "Bridal Package" duplicate
--
-- Migration 058 seeded a top-level "Bridal" category, but the database
-- already had a legacy "Bridal Package" row from an earlier admin tool.
-- Vendors now see both in the picker, which is confusing.
--
-- We resolve by re-pointing any FK references from "Bridal Package" to
-- "Bridal" (the cleaner name), then deleting the legacy row. Idempotent —
-- safe to run on any database that may or may not have the dupe.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_bridal_package_id UUID;
  v_bridal_id         UUID;
BEGIN
  SELECT id INTO v_bridal_package_id
    FROM public.service_categories
   WHERE LOWER(name) = LOWER('Bridal Package')
     AND parent_id IS NULL
     AND vendor_id IS NULL
   LIMIT 1;

  SELECT id INTO v_bridal_id
    FROM public.service_categories
   WHERE LOWER(name) = LOWER('Bridal')
     AND parent_id IS NULL
     AND vendor_id IS NULL
   LIMIT 1;

  -- Both rows exist → consolidate.
  IF v_bridal_package_id IS NOT NULL AND v_bridal_id IS NOT NULL THEN
    -- Re-point any FK references on services to the canonical row first.
    UPDATE public.services
       SET category_id = v_bridal_id
     WHERE category_id = v_bridal_package_id;

    -- Re-point any subcategories that hang off "Bridal Package".
    UPDATE public.service_categories
       SET parent_id = v_bridal_id
     WHERE parent_id = v_bridal_package_id;

    -- Drop the legacy row.
    DELETE FROM public.service_categories WHERE id = v_bridal_package_id;
  END IF;
END $$;
