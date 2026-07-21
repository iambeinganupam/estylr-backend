ALTER TABLE public.customer_profiles
  DROP COLUMN IF EXISTS service_code,
  DROP COLUMN IF EXISTS service_code_issued_at;
