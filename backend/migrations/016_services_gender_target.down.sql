-- TYPE: schema
-- Down migration for 016_services_gender_target.up.sql
-- Removes: gender_target column from services table

ALTER TABLE public.services
  DROP COLUMN IF EXISTS gender_target;
