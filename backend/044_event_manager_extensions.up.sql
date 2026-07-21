-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 044_event_manager_extensions
-- Description: Persistence for vendors, guests, budget items, tasks (timeline),
--              payments, transactions, portfolio, templates, and communications
--              owned by event managers. Removes the dashboard's dependency on
--              hardcoded mock data.
-- Depends on:  011_event_manager (event_bookings_extended), 003_vendors,
--              002_users_and_auth
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Add client-info + services columns to event_bookings_extended ───────────
ALTER TABLE public.event_bookings_extended
  ADD COLUMN IF NOT EXISTS client_name    TEXT,
  ADD COLUMN IF NOT EXISTS client_contact TEXT,
  ADD COLUMN IF NOT EXISTS client_email   TEXT,
  ADD COLUMN IF NOT EXISTS services       JSONB NOT NULL DEFAULT '[]';

-- ── Event Vendors (per-event vendor shortlist / confirmation) ────────────────
CREATE TYPE event_vendor_status AS ENUM ('shortlisted', 'confirmed', 'rejected');

CREATE TABLE public.event_vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  subcategory     TEXT,
  freelancer_id   UUID REFERENCES public.freelancer_profiles(id) ON DELETE SET NULL,
  rating          NUMERIC(3,2),
  reviews_count   INTEGER NOT NULL DEFAULT 0,
  price           TEXT,
  location        TEXT,
  contact         TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  availability    TEXT,
  status          event_vendor_status NOT NULL DEFAULT 'shortlisted',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_vendors_event ON public.event_vendors(event_id, status);

-- ── Managed Guests (per managed event — distinct from customer event_attendees) ─
CREATE TYPE rsvp_status AS ENUM ('pending', 'attending', 'declined');
CREATE TYPE guest_category AS ENUM ('family', 'friends', 'colleagues');
CREATE TYPE guest_side AS ENUM ('host', 'client', 'mutual');

CREATE TABLE public.event_managed_guests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  rsvp_status           rsvp_status NOT NULL DEFAULT 'pending',
  dietary_restrictions  TEXT,
  plus_one              BOOLEAN NOT NULL DEFAULT FALSE,
  category              guest_category,
  side                  guest_side,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_guests_event ON public.event_managed_guests(event_id, rsvp_status);

-- ── Budget items per event ───────────────────────────────────────────────────
CREATE TYPE budget_item_status AS ENUM ('pending', 'paid', 'overdue');

CREATE TABLE public.event_budget_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  item            TEXT NOT NULL,
  budgeted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  status          budget_item_status NOT NULL DEFAULT 'pending',
  vendor_name     TEXT,
  vendor_id       UUID REFERENCES public.event_vendors(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_budget_event ON public.event_budget_items(event_id, status);

-- ── Tasks / timeline per event ───────────────────────────────────────────────
CREATE TYPE event_task_status AS ENUM ('pending', 'in_progress', 'completed');

CREATE TABLE public.event_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  due_date            DATE,
  status              event_task_status NOT NULL DEFAULT 'pending',
  assignee            TEXT,
  assigned_vendor_id  UUID REFERENCES public.event_vendors(id) ON DELETE SET NULL,
  category            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_tasks_event ON public.event_tasks(event_id, status, due_date);

-- ── Payments (vendor-level rollup per event) ─────────────────────────────────
CREATE TYPE event_payment_status AS ENUM ('pending', 'partial', 'paid', 'overdue');

CREATE TABLE public.event_payments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id               UUID NOT NULL REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  vendor_id              UUID REFERENCES public.event_vendors(id) ON DELETE SET NULL,
  vendor_name            TEXT NOT NULL,
  amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  status                 event_payment_status NOT NULL DEFAULT 'pending',
  due_date               DATE,
  paid_date              DATE,
  category               TEXT,
  description            TEXT,
  related_budget_item_id UUID REFERENCES public.event_budget_items(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_payments_event ON public.event_payments(event_id, status);

-- ── Transactions (individual money movements against payments) ───────────────
CREATE TYPE event_tx_type   AS ENUM ('payment', 'refund', 'advance');
CREATE TYPE event_tx_method AS ENUM ('cash', 'bank-transfer', 'upi', 'card', 'cheque');
CREATE TYPE event_tx_status AS ENUM ('completed', 'pending', 'failed');

CREATE TABLE public.event_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  payment_id      UUID REFERENCES public.event_payments(id) ON DELETE SET NULL,
  vendor_id       UUID REFERENCES public.event_vendors(id) ON DELETE SET NULL,
  vendor_name     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  tx_type         event_tx_type   NOT NULL DEFAULT 'payment',
  tx_method       event_tx_method NOT NULL DEFAULT 'bank-transfer',
  status          event_tx_status NOT NULL DEFAULT 'completed',
  tx_date         DATE NOT NULL,
  reference       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_tx_event ON public.event_transactions(event_id, tx_date DESC);

-- ── Portfolio (one row per event manager) ────────────────────────────────────
CREATE TABLE public.event_manager_portfolios (
  user_id          UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name     TEXT,
  bio              TEXT,
  city             TEXT,
  years_experience INTEGER,
  starting_price   NUMERIC(10,2),
  services         JSONB NOT NULL DEFAULT '[]',
  gallery          JSONB NOT NULL DEFAULT '[]',
  certifications   JSONB NOT NULL DEFAULT '[]',
  specializations  JSONB NOT NULL DEFAULT '[]',
  contact_email    TEXT,
  contact_phone    TEXT,
  data             JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Templates owned by event managers ────────────────────────────────────────
CREATE TABLE public.event_manager_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_manager_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  default_services     JSONB NOT NULL DEFAULT '[]',
  default_tasks        JSONB NOT NULL DEFAULT '[]',
  default_budget_items JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_em_templates_manager ON public.event_manager_templates(event_manager_id);

-- ── Communications (lightweight thread between manager and vendor / client) ──
CREATE TYPE event_message_direction AS ENUM ('inbound', 'outbound');

CREATE TABLE public.event_communications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID REFERENCES public.event_bookings_extended(id) ON DELETE CASCADE,
  event_manager_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  thread_key       TEXT NOT NULL,
  direction        event_message_direction NOT NULL,
  sender_name      TEXT NOT NULL,
  body             TEXT NOT NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_comms_manager_thread
  ON public.event_communications(event_manager_id, thread_key, sent_at DESC);

-- ── updated_at triggers ──────────────────────────────────────────────────────
CREATE TRIGGER trg_event_vendors_updated_at BEFORE UPDATE ON public.event_vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_event_guests_updated_at BEFORE UPDATE ON public.event_managed_guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_event_budget_updated_at BEFORE UPDATE ON public.event_budget_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_event_tasks_updated_at BEFORE UPDATE ON public.event_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_event_payments_updated_at BEFORE UPDATE ON public.event_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_event_tx_updated_at BEFORE UPDATE ON public.event_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_em_portfolio_updated_at BEFORE UPDATE ON public.event_manager_portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_em_templates_updated_at BEFORE UPDATE ON public.event_manager_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
