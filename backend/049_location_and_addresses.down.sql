-- TYPE: schema
ALTER TABLE public.event_bookings_extended
  DROP COLUMN IF EXISTS venue_coordinates,
  DROP COLUMN IF EXISTS venue_country_code,
  DROP COLUMN IF EXISTS venue_postal_code,
  DROP COLUMN IF EXISTS venue_state,
  DROP COLUMN IF EXISTS venue_city,
  DROP COLUMN IF EXISTS venue_address_line2,
  DROP COLUMN IF EXISTS venue_address_line1;

DROP TABLE IF EXISTS public.user_addresses;
