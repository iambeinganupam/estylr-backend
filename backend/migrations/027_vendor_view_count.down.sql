-- TYPE: schema
-- Down migration for 027_vendor_view_count.up.sql
-- Removes: view_count column from salon_locations and freelancer_profiles tables

ALTER TABLE public.freelancer_profiles
  DROP COLUMN IF EXISTS view_count;

ALTER TABLE public.salon_locations
  DROP COLUMN IF EXISTS view_count;
