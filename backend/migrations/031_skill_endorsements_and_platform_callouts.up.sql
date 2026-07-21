-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031 — Skill endorsements + platform marketing callouts
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. freelancer_skill_endorsements: many-to-many between users and skills,
--    one row per (skill, endorser). The denormalized count on
--    freelancer_skills.endorsement_count is kept in sync via trigger so reads
--    of the skills list stay a single round-trip.
-- 2. platform_callouts: CMS-owned marketing copy shown on the public auth
--    pages. Extracted from hard-coded JSX so marketing can edit without a
--    deploy. Seeded with the three current entries.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Skill Endorsements ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_skill_endorsements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id    UUID NOT NULL REFERENCES public.freelancer_skills(id) ON DELETE CASCADE,
  endorser_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (skill_id, endorser_id)
);
CREATE INDEX IF NOT EXISTS idx_skill_endorsements_endorser
  ON public.freelancer_skill_endorsements(endorser_id);

-- Trigger: keep freelancer_skills.endorsement_count consistent
CREATE OR REPLACE FUNCTION public.bump_skill_endorsement_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.freelancer_skills
       SET endorsement_count = endorsement_count + 1
     WHERE id = NEW.skill_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.freelancer_skills
       SET endorsement_count = GREATEST(endorsement_count - 1, 0)
     WHERE id = OLD.skill_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_skill_endorsement_count_ins ON public.freelancer_skill_endorsements;
CREATE TRIGGER trg_skill_endorsement_count_ins
  AFTER INSERT ON public.freelancer_skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.bump_skill_endorsement_count();

DROP TRIGGER IF EXISTS trg_skill_endorsement_count_del ON public.freelancer_skill_endorsements;
CREATE TRIGGER trg_skill_endorsement_count_del
  AFTER DELETE ON public.freelancer_skill_endorsements
  FOR EACH ROW EXECUTE FUNCTION public.bump_skill_endorsement_count();

-- ── 2. Platform Marketing Callouts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_callouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context     VARCHAR(50) NOT NULL DEFAULT 'auth_page',
  icon        VARCHAR(50) NOT NULL,
  text        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_callouts_context_active
  ON public.platform_callouts(context, sort_order)
 WHERE is_active = TRUE;

CREATE TRIGGER trg_platform_callouts_updated_at
  BEFORE UPDATE ON public.platform_callouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed: replace the previously-hardcoded JSX strings on AuthPage.
INSERT INTO public.platform_callouts (context, icon, text, sort_order)
VALUES
  ('auth_page', 'Shield',    'Verified professionals with background checks',     1),
  ('auth_page', 'Star',      '4.8★ average rating across 5,000+ stylists',         2),
  ('auth_page', 'Sparkles',  'Secure weekly payments with full transparency',     3)
ON CONFLICT DO NOTHING;
