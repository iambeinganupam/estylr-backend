-- Migration 068: reclassify any remaining Bridal* categories to audience='wedding'
-- Migration 062 used a fixed-case name list and missed "Bridal" (lowercase 'm'
-- variant from migration 058) and "Bridal makeup" (subcategory). This catches
-- them via ILIKE so the grooming-portal homepage no longer surfaces wedding
-- categories.
UPDATE public.service_categories
   SET audience = 'wedding',
       is_active = FALSE
 WHERE vendor_id IS NULL
   AND audience = 'grooming'
   AND (
     name ILIKE 'bridal%'
     OR name ILIKE 'mehndi%'
     OR name ILIKE '%wedding%'
     OR name ILIKE 'tent %'
     OR name ILIKE 'catering%'
   );
