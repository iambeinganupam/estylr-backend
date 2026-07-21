-- Migration 068 (down): re-activate the categories this migration deactivated.
UPDATE public.service_categories
   SET audience = 'grooming',
       is_active = TRUE
 WHERE vendor_id IS NULL
   AND audience = 'wedding'
   AND (
     name ILIKE 'bridal%'
     OR name ILIKE 'mehndi%'
     OR name ILIKE '%wedding%'
     OR name ILIKE 'tent %'
     OR name ILIKE 'catering%'
   );
