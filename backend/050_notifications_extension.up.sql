-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 050 — Notification dispatch extension
--   * Add outbox-state columns to public.notifications
--   * Add notification_preferences (per-user channel opt-out matrix)
-- Note: notification_type enum values were added in 050a (separate file due to
-- Postgres restriction on ALTER TYPE ADD VALUE inside a transaction block).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key        TEXT,
  ADD COLUMN IF NOT EXISTS channels          TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  ADD COLUMN IF NOT EXISTS delivery_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','partial','delivered','failed','skipped')),
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_error    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_dedupe
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_pending
  ON public.notifications (created_at)
  WHERE delivery_status = 'pending';

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id        UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  type_overrides JSONB  NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-user channel preferences. JSONB type_overrides allows per-type opt-out, e.g. {"promotional":{"email":false}}.';
