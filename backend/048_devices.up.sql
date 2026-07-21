-- Migration 045: Push-notification device registry.
--
-- A row per (user, expo_push_token). The same user can have multiple devices.
-- The same device token can move between users (rare — e.g. shared device);
-- the unique constraint is on the token alone so the latest user-wins.

CREATE TABLE IF NOT EXISTS public.devices (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expo_push_token text        NOT NULL UNIQUE,
  audience        text        NOT NULL CHECK (audience IN ('salon','freelancer','customer','staff','events','admin')),
  platform        text        NOT NULL CHECK (platform IN ('ios','android','web','macos','windows')),
  device_name     text,
  app_version     text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id   ON public.devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_audience  ON public.devices(audience);
CREATE INDEX IF NOT EXISTS idx_devices_is_active ON public.devices(is_active) WHERE is_active;

COMMENT ON TABLE public.devices IS
  'Push-notification device registry. Populated by mobile apps on auth via POST /devices/register.';
