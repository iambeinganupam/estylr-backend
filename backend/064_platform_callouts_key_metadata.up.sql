-- Migration 064: platform_callouts extension for addressable structured content.
-- Existing rows (auth page, etc.) keep key=NULL and continue working as
-- ordered icon+text lists. New homepage rows use key for stable lookup and
-- metadata for href / button labels / etc.

ALTER TABLE public.platform_callouts
  ADD COLUMN IF NOT EXISTS key      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Unique per (context, key) when key IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS platform_callouts_context_key_uniq
  ON public.platform_callouts (context, key)
  WHERE key IS NOT NULL;
