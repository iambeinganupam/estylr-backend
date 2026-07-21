-- ─────────────────────────────────────────────────────────────────────────────
-- 058 — Vendor-scoped service categories
--
-- Until now, `service_categories` was a single admin-curated global taxonomy.
-- Vendors had no way to add a niche specialty / skill without filing an admin
-- ticket. We now allow vendors to create their own categories + subcategories
-- inline, scoped to that vendor.
--
-- Semantics after this migration:
--   • `vendor_id IS NULL`            → GLOBAL row (admin-curated). Visible to
--                                       every vendor. Created/updated only via
--                                       the admin endpoints.
--   • `vendor_id IS NOT NULL`        → VENDOR-CUSTOM row. Visible only to that
--                                       vendor. Created/updated by the vendor
--                                       via the catalog endpoints. Admin can
--                                       still see/edit/promote it.
--   • `vendor_type` is the polymorphic discriminator (`freelancer` or
--     `salon_location`), matching the rest of the codebase.
--
-- Uniqueness: case-insensitive `name` is unique within `(vendor_id, parent_id)`
-- so a vendor can have one "Hair" category, but two vendors can have their
-- own "Hair" rows (admin-global vs. salon-custom), and the same name can
-- appear under different parents.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.service_categories
  ADD COLUMN vendor_type VARCHAR(20),
  ADD COLUMN vendor_id   UUID,
  ADD CONSTRAINT service_categories_vendor_pair_chk
    CHECK ((vendor_type IS NULL) = (vendor_id IS NULL));

-- Common lookup: "all global + this vendor's customs", filterable by
-- parent_id for the picker's "subcategories under X" call.
CREATE INDEX IF NOT EXISTS service_categories_vendor_idx
  ON public.service_categories (vendor_type, vendor_id);

CREATE INDEX IF NOT EXISTS service_categories_parent_idx
  ON public.service_categories (parent_id);

-- ── Seed the curated global taxonomy ───────────────────────────────────────
-- Seeding runs BEFORE the unique indexes so any pre-existing duplicate names
-- (left over from earlier admin tooling) won't block the migration. The
-- WHERE-NOT-EXISTS guard makes the inserts idempotent.

-- Top-level categories.
INSERT INTO public.service_categories (parent_id, name, sort_order, is_active)
SELECT NULL::uuid, name, sort_order, TRUE
FROM (VALUES
  ('Hair',    10),
  ('Beard',   20),
  ('Skin',    30),
  ('Nails',   40),
  ('Spa',     50),
  ('Makeup',  60),
  ('Massage', 70),
  ('Bridal',  80)
) AS seed(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_categories sc
   WHERE sc.parent_id IS NULL
     AND sc.vendor_id IS NULL
     AND LOWER(sc.name) = LOWER(seed.name)
);

-- Subcategories. `parent_lookup_name` is matched against the just-seeded
-- (or pre-existing) top-level row. Two parents can share the same name only
-- if one was a duplicate of the other before this migration — we resolve
-- ambiguity by picking the lowest-`sort_order` row.
INSERT INTO public.service_categories (parent_id, name, sort_order, is_active)
SELECT parent.id, seed.name, seed.sort_order, TRUE
FROM (VALUES
  -- Hair
  ('Hair',   'Hair cutting',      10),
  ('Hair',   'Hair coloring',     20),
  ('Hair',   'Highlights',        30),
  ('Hair',   'Balayage',          40),
  ('Hair',   'Keratin treatment', 50),
  ('Hair',   'Hair smoothing',    60),
  ('Hair',   'Hair styling',      70),
  -- Beard
  ('Beard',  'Beard trim',        10),
  ('Beard',  'Beard shaping',     20),
  ('Beard',  'Hot towel shave',   30),
  -- Skin
  ('Skin',   'Facial',            10),
  ('Skin',   'Cleanup',           20),
  ('Skin',   'Threading',         30),
  ('Skin',   'Waxing',            40),
  ('Skin',   'Bleach',            50),
  -- Nails
  ('Nails',  'Manicure',          10),
  ('Nails',  'Pedicure',          20),
  ('Nails',  'Gel nails',         30),
  ('Nails',  'Nail art',          40),
  -- Spa
  ('Spa',    'Body polish',       10),
  ('Spa',    'Aromatherapy',      20),
  -- Makeup
  ('Makeup', 'Bridal makeup',     10),
  ('Makeup', 'Party makeup',      20),
  ('Makeup', 'HD makeup',         30),
  ('Makeup', 'Airbrush makeup',   40)
) AS seed(parent_lookup_name, name, sort_order)
JOIN LATERAL (
  SELECT id FROM public.service_categories
   WHERE parent_id IS NULL
     AND vendor_id IS NULL
     AND LOWER(name) = LOWER(seed.parent_lookup_name)
   ORDER BY sort_order, id
   LIMIT 1
) AS parent ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_categories sc
   WHERE sc.parent_id = parent.id
     AND sc.vendor_id IS NULL
     AND LOWER(sc.name) = LOWER(seed.name)
);

-- ── Unique indexes (created AFTER seeding to avoid blocking on legacy dupes) ──
-- Two partial indexes keep the NULL-vendor (global) and vendor-scoped cases
-- independent. Postgres treats NULLs as distinct in normal UNIQUE constraints,
-- which would otherwise allow duplicate "Hair" rows at the global tier.
CREATE UNIQUE INDEX IF NOT EXISTS service_categories_global_uniq_name
  ON public.service_categories (
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    LOWER(name)
  )
  WHERE vendor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_categories_vendor_uniq_name
  ON public.service_categories (
    vendor_type,
    vendor_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    LOWER(name)
  )
  WHERE vendor_id IS NOT NULL;
