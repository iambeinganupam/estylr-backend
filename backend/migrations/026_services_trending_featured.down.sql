-- TYPE: schema
-- Down migration for 026_services_trending_featured.up.sql
-- Removes: is_trending, is_featured columns from services table

ALTER TABLE public.services
  DROP COLUMN IF EXISTS is_featured,
  DROP COLUMN IF EXISTS is_trending;
