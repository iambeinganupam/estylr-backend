-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────
-- 044_password_reset_tokens — single-use tokens for the forgot/reset flow.
-- Token is stored as SHA-256 hash; plaintext is only delivered via email.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  token_hash    TEXT PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON public.password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON public.password_reset_tokens (expires_at);

COMMENT ON TABLE  public.password_reset_tokens             IS 'Single-use SHA-256-hashed tokens. Consumed atomically on reset.';
COMMENT ON COLUMN public.password_reset_tokens.consumed_at IS 'Set on successful reset; row is kept for audit until expiry sweep.';
