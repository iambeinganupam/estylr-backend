-- Rollback for 058 — vendor-scoped service categories.
-- Leaves seeded global rows in place (they may have FK references from
-- services.category_id) and only drops the new vendor-scope columns / indexes.

DROP INDEX IF EXISTS public.service_categories_vendor_uniq_name;
DROP INDEX IF EXISTS public.service_categories_global_uniq_name;
DROP INDEX IF EXISTS public.service_categories_parent_idx;
DROP INDEX IF EXISTS public.service_categories_vendor_idx;

ALTER TABLE public.service_categories
  DROP CONSTRAINT IF EXISTS service_categories_vendor_pair_chk,
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS vendor_type;
