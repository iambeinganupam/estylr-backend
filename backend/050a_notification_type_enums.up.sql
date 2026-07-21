-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 050a — Extend notification_type enum
--   ALTER TYPE ADD VALUE cannot run inside a transaction block (Postgres < 12).
--   The migration runner wraps each file in BEGIN/COMMIT, so enum additions are
--   split into this standalone file which the runner applies first.
--   Postgres 12+ supports ADD VALUE IF NOT EXISTS inside a tx, but we keep the
--   split for broad compatibility.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'kyc_submitted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'kyc_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'kyc_rejected';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'kyc_resubmit_requested';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'message_received';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'plan_activated';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'plan_expired';
