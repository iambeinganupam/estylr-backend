-- Reverses 039_vendor_payments_and_plans.up.sql

DROP VIEW IF EXISTS public.vendor_outstanding_balance;
DROP TABLE IF EXISTS public.vendor_dues_ledger;
DROP TYPE IF EXISTS vendor_dues_entry_type;

DROP TABLE IF EXISTS public.subscription_plans;

ALTER TABLE public.freelancer_profiles
  DROP CONSTRAINT IF EXISTS freelancer_profiles_upi_id_format,
  DROP COLUMN IF EXISTS subscription_active_until,
  DROP COLUMN IF EXISTS upi_display_name,
  DROP COLUMN IF EXISTS upi_id;

ALTER TABLE public.business_accounts
  DROP CONSTRAINT IF EXISTS business_accounts_upi_id_format,
  DROP COLUMN IF EXISTS subscription_active_until,
  DROP COLUMN IF EXISTS upi_display_name,
  DROP COLUMN IF EXISTS upi_id;
