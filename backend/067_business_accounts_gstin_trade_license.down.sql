-- Migration 067 (down): remove the two columns.
ALTER TABLE public.business_accounts
  DROP COLUMN IF EXISTS trade_license,
  DROP COLUMN IF EXISTS gstin;
