-- 038 down — drop the inclusions column.

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_inclusions_is_array;

ALTER TABLE public.services
  DROP COLUMN IF EXISTS inclusions;
