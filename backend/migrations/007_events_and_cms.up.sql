-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 007_events_and_cms
-- Description: Event manager, CMS pages, newsletter, planner
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled');
CREATE TYPE cms_status AS ENUM ('draft', 'published', 'archived');

-- ── Events ──
CREATE TABLE public.events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title         VARCHAR(200) NOT NULL,
  event_date    DATE NOT NULL,
  notes         TEXT,
  status        event_status NOT NULL DEFAULT 'draft',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Event Attendees ──
CREATE TABLE public.event_attendees (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  guest_name            VARCHAR(100) NOT NULL,
  service_id            UUID REFERENCES public.services(id),
  preferred_vendor_id   UUID,
  appointment_id        UUID REFERENCES public.appointments(id),
  notes                 VARCHAR(500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Event Templates ──
CREATE TABLE public.event_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  services    JSONB NOT NULL DEFAULT '[]', -- Array of suggested services
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CMS Pages ──
CREATE TABLE public.cms_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id         UUID REFERENCES public.users(id),
  title             VARCHAR(200) NOT NULL,
  slug              VARCHAR(200) NOT NULL UNIQUE,
  content           TEXT NOT NULL,
  meta_title        VARCHAR(100),
  meta_description  VARCHAR(200),
  tags              JSONB,
  status            cms_status NOT NULL DEFAULT 'draft',
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Contact Leads ──
CREATE TYPE inquiry_type AS ENUM ('partnership', 'support', 'feedback', 'press', 'other');

CREATE TABLE public.contact_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name      VARCHAR(50) NOT NULL,
  email_address   VARCHAR(255) NOT NULL,
  inquiry_type    inquiry_type NOT NULL,
  message_body    TEXT NOT NULL,
  is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by     UUID REFERENCES public.users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Newsletter Subscribers ──
CREATE TABLE public.newsletter_subscribers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address   VARCHAR(255) NOT NULL UNIQUE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  source          VARCHAR(100) NOT NULL DEFAULT 'website',
  unsubscribed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Wedding / Event Planner ──
CREATE TABLE public.planner_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_name  VARCHAR(200) NOT NULL,
  event_date  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.planner_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planner_event_id  UUID NOT NULL REFERENCES public.planner_events(id) ON DELETE CASCADE,
  title             VARCHAR(200) NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_completed      BOOLEAN NOT NULL DEFAULT FALSE,
  due_date          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_events_organizer ON public.events(organizer_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_cms_slug ON public.cms_pages(slug) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_cms_status ON public.cms_pages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_leads_created ON public.contact_leads(created_at DESC) WHERE is_resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_planner_user ON public.planner_events(user_id);
CREATE INDEX IF NOT EXISTS idx_planner_tasks_event ON public.planner_tasks(planner_event_id, sort_order);

CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_cms_updated_at BEFORE UPDATE ON public.cms_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
