-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 032 — Freelancer presence (online / online_since_at)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds the timestamp companion to freelancer_profiles.is_open_to_work so the
-- freelancer dashboard can persist "Online since X" across sessions instead of
-- counting from each tab open. The column is paired with a CHECK constraint
-- that keeps the two presence fields in lock-step regardless of which write
-- path mutates them.
--
-- State invariants (enforced by freelancer_profiles_presence_consistency):
--   is_open_to_work = TRUE  ⇒  online_since_at IS NOT NULL
--   is_open_to_work = FALSE ⇒  online_since_at IS NULL
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column.
ALTER TABLE public.freelancer_profiles
  ADD COLUMN IF NOT EXISTS online_since_at TIMESTAMPTZ;

-- 2. Backfill any rows that were already online — best-effort uses updated_at.
--    Without this, the CHECK constraint below would reject existing data.
UPDATE public.freelancer_profiles
   SET online_since_at = updated_at
 WHERE is_open_to_work = TRUE
   AND online_since_at IS NULL;

-- 3. Enforce the lock-step invariant.
ALTER TABLE public.freelancer_profiles
  DROP CONSTRAINT IF EXISTS freelancer_profiles_presence_consistency;

ALTER TABLE public.freelancer_profiles
  ADD CONSTRAINT freelancer_profiles_presence_consistency CHECK (
    (is_open_to_work = TRUE  AND online_since_at IS NOT NULL)
    OR
    (is_open_to_work = FALSE AND online_since_at IS NULL)
  );

-- 4. Partial index for "live freelancers, most recent first" queries
--    (used by discovery/search later; cheap because only online rows are indexed).
CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_online_since
  ON public.freelancer_profiles (online_since_at DESC)
  WHERE is_open_to_work = TRUE;

COMMENT ON COLUMN public.freelancer_profiles.online_since_at IS
  'Timestamp when the freelancer last transitioned to online. NULL while offline. Always NOT NULL when is_open_to_work=TRUE (enforced by CHECK).';
