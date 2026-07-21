-- ─────────────────────────────────────────────────────────────────────────────
-- 043_otp_codes — Postgres-backed login OTP storage with brute-force cap.
-- Replaces the in-memory Map in auth.repository.ts that did not survive
-- restarts and had no per-phone attempt limiting.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otp_codes (
  phone_number      TEXT PRIMARY KEY,
  code_hash         TEXT        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  attempts          SMALLINT    NOT NULL DEFAULT 0,
  last_attempt_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at
  ON public.otp_codes (expires_at);

COMMENT ON TABLE  public.otp_codes      IS 'Login OTP store. One row per phone, deleted on successful verification or expiry sweep.';
COMMENT ON COLUMN public.otp_codes.code_hash IS 'bcrypt hash of the 6-digit code. Plaintext is never stored.';
COMMENT ON COLUMN public.otp_codes.attempts  IS 'Increment per failed verify; reject after >=5.';
