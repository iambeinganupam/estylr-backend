-- TYPE: schema
DROP TABLE IF EXISTS public.notification_preferences;
DROP INDEX IF EXISTS public.idx_notifications_outbox_pending;
DROP INDEX IF EXISTS public.uq_notifications_user_dedupe;
ALTER TABLE public.notifications
  DROP COLUMN IF EXISTS delivery_error,
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS last_attempt_at,
  DROP COLUMN IF EXISTS delivery_attempts,
  DROP COLUMN IF EXISTS delivery_status,
  DROP COLUMN IF EXISTS channels,
  DROP COLUMN IF EXISTS dedupe_key;
-- Note: enum values added with ALTER TYPE ADD VALUE cannot be removed in Postgres.
-- The down migration intentionally leaves the enum values in place; they are inert
-- once unused.
