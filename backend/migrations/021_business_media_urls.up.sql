-- Migration 021: Add logo_url and cover_image_url to business_accounts
ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS logo_url       VARCHAR(500),
  ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500);
