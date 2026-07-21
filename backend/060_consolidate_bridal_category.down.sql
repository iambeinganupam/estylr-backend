-- Rollback: re-insert a "Bridal Package" row if a vendor's services point at
-- an id that used to be "Bridal Package". We don't have that mapping any more
-- — restoring is best-effort and idempotent.

INSERT INTO public.service_categories (parent_id, name, sort_order, is_active)
SELECT NULL::uuid, 'Bridal Package', 0, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_categories
   WHERE parent_id IS NULL
     AND vendor_id IS NULL
     AND LOWER(name) = LOWER('Bridal Package')
);
