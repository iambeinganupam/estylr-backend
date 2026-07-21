-- TYPE: schema
-- Down migration for 029_salon_amenities.up.sql
-- Removes: amenities column and its GIN index from salon_locations table

DROP INDEX IF EXISTS idx_salon_locations_amenities;

ALTER TABLE public.salon_locations
  DROP COLUMN IF EXISTS amenities;
