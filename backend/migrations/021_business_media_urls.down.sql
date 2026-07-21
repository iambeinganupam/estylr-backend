-- TYPE: schema
-- Down migration for 021_business_media_urls.up.sql
-- Removes: logo_url, cover_image_url columns from business_accounts table

ALTER TABLE public.business_accounts
  DROP COLUMN IF EXISTS cover_image_url,
  DROP COLUMN IF EXISTS logo_url;
