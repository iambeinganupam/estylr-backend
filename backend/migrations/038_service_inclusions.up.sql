-- ─────────────────────────────────────────────────────────────────────────────
-- 038 — Service inclusions
--
-- Adds `inclusions` to `public.services`: a JSONB array of free-text bullet
-- points surfaced in the service detail sheet's "What's Included" panel.
--
-- Why JSONB rather than a child table:
--   • Inclusions are presentational — read alongside the parent row 99% of
--     the time, never queried independently.
--   • Bounded list (each row is small; clients enforce a sane max length).
--   • Avoids a join + hydration on the hot list-services path.
--
-- The column is NOT NULL with a `'[]'::jsonb` default so the existing rows
-- and the catalog repo's plain INSERT both stay correct without a backfill.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.services
  ADD COLUMN inclusions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Validation: enforce that the value is always a JSON array of strings.
ALTER TABLE public.services
  ADD CONSTRAINT services_inclusions_is_array
  CHECK (jsonb_typeof(inclusions) = 'array');

COMMENT ON COLUMN public.services.inclusions IS
  'JSONB array of strings — bullet points shown under "What''s Included" in the service detail sheet. Free-text, vendor-authored.';
