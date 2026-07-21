-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────
-- 045_customer_service_code — Rapido-style permanent service OTP per customer.
-- The code is plaintext (matches product requirement: always viewable by the
-- owner; never rotatable). Backfill assigns codes to any pre-existing rows
-- so the NOT NULL constraint holds.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS service_code           TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS service_code_issued_at TIMESTAMPTZ;

-- Backfill: any existing row without a code gets a 6-digit random one.
-- Production/staging start empty (no customer rows exist yet under our
-- spec §3.1.1 no-seed-data rule), so this is a no-op there. Dev/test may
-- have rows from prior signups during integration runs.
UPDATE public.customer_profiles
   SET service_code           = LPAD((100000 + floor(random() * 900000)::INT)::TEXT, 6, '0'),
       service_code_issued_at = NOW()
 WHERE service_code = '';

-- Drop the empty-string default now that every row has a real value.
ALTER TABLE public.customer_profiles
  ALTER COLUMN service_code DROP DEFAULT;

COMMENT ON COLUMN public.customer_profiles.service_code           IS '6-digit Rapido-style permanent service OTP. Plaintext by design; never rotated.';
COMMENT ON COLUMN public.customer_profiles.service_code_issued_at IS 'Timestamp of code issuance (signup or backfill). For audit only.';
