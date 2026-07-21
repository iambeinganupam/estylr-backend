-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025 — Freelancer resume tables + user preferences
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds normalized tables for freelancer profile metadata that was previously
-- absent from the schema but consumed by the freelancer dashboard:
--   - freelancer_experience       (work history entries)
--   - freelancer_skills           (skills grouped by category, with endorsements)
--   - freelancer_certifications   (qualifications)
--   - freelancer_languages        (languages spoken)
--   - freelancer_salon_associations (current/past salon affiliations)
-- Also introduces user_preferences (notification + UI prefs, role-agnostic) and
-- the is_open_to_work flag on freelancer_profiles for the recruiting toggle.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Freelancer Experience ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_experience (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id UUID NOT NULL REFERENCES public.freelancer_profiles(id) ON DELETE CASCADE,
  role          VARCHAR(150) NOT NULL,
  company       VARCHAR(200) NOT NULL,
  location      VARCHAR(200),
  start_date    DATE NOT NULL,
  end_date      DATE,
  is_current    BOOLEAN NOT NULL DEFAULT FALSE,
  highlights    TEXT[] NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT freelancer_experience_date_range CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_freelancer_experience_freelancer
  ON public.freelancer_experience(freelancer_id, display_order, start_date DESC);

CREATE TRIGGER trg_freelancer_experience_updated_at
  BEFORE UPDATE ON public.freelancer_experience
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. Freelancer Skills ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_skills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id     UUID NOT NULL REFERENCES public.freelancer_profiles(id) ON DELETE CASCADE,
  category          VARCHAR(100) NOT NULL,
  skill_name        VARCHAR(150) NOT NULL,
  endorsement_count INTEGER NOT NULL DEFAULT 0 CHECK (endorsement_count >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (freelancer_id, category, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_freelancer_skills_freelancer
  ON public.freelancer_skills(freelancer_id, category);

-- ── 3. Freelancer Certifications ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_certifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id  UUID NOT NULL REFERENCES public.freelancer_profiles(id) ON DELETE CASCADE,
  name           VARCHAR(200) NOT NULL,
  issuer         VARCHAR(200),
  year           INTEGER CHECK (year IS NULL OR (year BETWEEN 1900 AND 2100)),
  credential_url VARCHAR(500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_freelancer_certifications_freelancer
  ON public.freelancer_certifications(freelancer_id, year DESC);

-- ── 4. Freelancer Languages ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freelancer_languages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id UUID NOT NULL REFERENCES public.freelancer_profiles(id) ON DELETE CASCADE,
  language      VARCHAR(80) NOT NULL,
  proficiency   VARCHAR(40),
  UNIQUE (freelancer_id, language)
);

-- ── 5. Freelancer Salon Associations (resume-style salon history) ─────────────
CREATE TABLE IF NOT EXISTS public.freelancer_salon_associations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id     UUID NOT NULL REFERENCES public.freelancer_profiles(id) ON DELETE CASCADE,
  salon_name        VARCHAR(200) NOT NULL,
  salon_location_id UUID REFERENCES public.salon_locations(id) ON DELETE SET NULL,
  location          VARCHAR(200),
  start_date        DATE NOT NULL,
  end_date          DATE,
  is_current        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT freelancer_salon_associations_date_range CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_freelancer_salon_associations_freelancer
  ON public.freelancer_salon_associations(freelancer_id, start_date DESC);

-- ── 6. User Preferences (role-agnostic notification + UI prefs) ──────────────
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id          UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  notif_bookings   BOOLEAN NOT NULL DEFAULT TRUE,
  notif_reminders  BOOLEAN NOT NULL DEFAULT TRUE,
  notif_payments   BOOLEAN NOT NULL DEFAULT TRUE,
  notif_promos     BOOLEAN NOT NULL DEFAULT FALSE,
  language         VARCHAR(10) NOT NULL DEFAULT 'en',
  dark_mode        BOOLEAN NOT NULL DEFAULT TRUE,
  low_data_mode    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 7. Recruiting toggle on freelancer_profiles ──────────────────────────────
ALTER TABLE public.freelancer_profiles
  ADD COLUMN IF NOT EXISTS is_open_to_work BOOLEAN NOT NULL DEFAULT FALSE;
