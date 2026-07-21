-- backend/migrations/011_event_manager.up.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 011_event_manager
-- Description: Add event_manager user role, event bookings and freelancer hires
-- Note: ALTER TYPE ADD VALUE runs inside a transaction on PostgreSQL 12+.
--       Neon/RDS use PG 15+ so this is safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Add event_manager to user_role ENUM ──
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'event_manager';

-- ── Managed Events (created by event managers, not customers) ──
CREATE TYPE event_booking_status AS ENUM ('planning', 'confirmed', 'completed', 'cancelled');

CREATE TABLE public.event_bookings_extended (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_manager_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  event_date        DATE NOT NULL,
  venue             TEXT,
  total_budget      NUMERIC(10,2),
  spent_budget      NUMERIC(10,2) NOT NULL DEFAULT 0,
  status            event_booking_status NOT NULL DEFAULT 'planning',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Freelancer Hires per Event ──
CREATE TYPE hire_status AS ENUM ('pending', 'confirmed', 'cancelled');

CREATE TABLE public.event_freelancer_hires (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  freelancer_id   UUID NOT NULL REFERENCES public.freelancer_profiles(id),
  agreed_rate     NUMERIC(10,2),
  status          hire_status NOT NULL DEFAULT 'pending',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (event_id, freelancer_id)
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_event_bookings_manager ON public.event_bookings_extended(event_manager_id, status);
CREATE INDEX IF NOT EXISTS idx_event_bookings_date ON public.event_bookings_extended(event_date);
CREATE INDEX IF NOT EXISTS idx_event_hires_event ON public.event_freelancer_hires(event_id, status);

CREATE TRIGGER trg_event_bookings_updated_at BEFORE UPDATE ON public.event_bookings_extended
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_event_hires_updated_at BEFORE UPDATE ON public.event_freelancer_hires
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
