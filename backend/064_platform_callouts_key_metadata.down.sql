-- Migration 064 (down).
DROP INDEX IF EXISTS platform_callouts_context_key_uniq;
ALTER TABLE public.platform_callouts
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS key;
