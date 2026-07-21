-- TYPE: schema
-- Down migration for 022_media_service_link.up.sql
-- Removes: service_id column and its index from media_items table

DROP INDEX IF EXISTS idx_media_items_service;

ALTER TABLE public.media_items
  DROP COLUMN IF EXISTS service_id;
