-- TYPE: schema
-- Down migration for 019_add_website_url_to_business_accounts.up.sql
-- Removes: website_url, description, contact_email, contact_phone columns
--          from business_accounts table

ALTER TABLE public.business_accounts
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_email,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS website_url;
