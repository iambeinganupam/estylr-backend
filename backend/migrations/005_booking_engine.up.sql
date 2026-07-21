-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 005_booking_engine
-- Description: Booking intents, appointments, transactions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE intent_status AS ENUM ('draft', 'locked', 'converted', 'expired', 'cancelled');
CREATE TYPE appointment_status AS ENUM ('confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE payment_method AS ENUM ('upi', 'card', 'cash', 'online');
CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- ── Booking Intents (Slot Lock — TTL 10 minutes) ──
CREATE TABLE public.booking_intents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES public.users(id),
  vendor_type         VARCHAR(20) NOT NULL,
  vendor_id           UUID NOT NULL,
  staff_member_id     UUID REFERENCES public.staff_members(id),
  scheduled_start     TIMESTAMPTZ NOT NULL,
  scheduled_end       TIMESTAMPTZ NOT NULL,
  calculated_total    NUMERIC(10,2) NOT NULL,
  status              intent_status NOT NULL DEFAULT 'locked',
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Booking Intent Line Items ──
CREATE TABLE public.intent_line_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id   UUID NOT NULL REFERENCES public.booking_intents(id) ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES public.services(id),
  locked_price NUMERIC(10,2) NOT NULL,   -- Price at time of booking (immutable snapshot)
  duration_minutes INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Appointments ──
CREATE TABLE public.appointments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id           UUID REFERENCES public.booking_intents(id),
  customer_id         UUID NOT NULL REFERENCES public.users(id),
  vendor_type         VARCHAR(20) NOT NULL,
  vendor_id           UUID NOT NULL,
  staff_member_id     UUID REFERENCES public.staff_members(id),
  service_id          UUID REFERENCES public.services(id),
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ NOT NULL,
  status              appointment_status NOT NULL DEFAULT 'confirmed',
  otp_code            VARCHAR(6),
  otp_verified_at     TIMESTAMPTZ,
  completion_note     TEXT,
  cancellation_reason TEXT,
  cancelled_by        UUID REFERENCES public.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Appointment Line Items (Price Snapshot) ──
CREATE TABLE public.appointment_line_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id    UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  service_id        UUID NOT NULL REFERENCES public.services(id),
  service_name      VARCHAR(200) NOT NULL,   -- Snapshot at booking time
  locked_price      NUMERIC(10,2) NOT NULL,
  duration_minutes  INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Transactions ──
CREATE TABLE public.transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id      UUID REFERENCES public.appointments(id),
  vendor_id           UUID NOT NULL,
  amount              NUMERIC(10,2) NOT NULL,
  currency            CHAR(3) NOT NULL DEFAULT 'INR',
  payment_method      payment_method,
  status              transaction_status NOT NULL DEFAULT 'pending',
  external_ref        VARCHAR(255),   -- Razorpay/Stripe payment ID
  gateway_response    JSONB,
  platform_fee        NUMERIC(10,2) NOT NULL DEFAULT 0,
  vendor_payout       NUMERIC(10,2) NOT NULL DEFAULT 0,
  refund_amount       NUMERIC(10,2),
  refund_reason       TEXT,
  refunded_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Staff Payouts ──
CREATE TYPE payout_status AS ENUM ('processing', 'paid', 'failed');

CREATE TABLE public.staff_payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL,
  staff_member_id   UUID NOT NULL REFERENCES public.staff_members(id),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  amount            NUMERIC(10,2) NOT NULL,
  status            payout_status NOT NULL DEFAULT 'processing',
  payout_reference  VARCHAR(255),
  failed_reason     TEXT,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_intents_customer ON public.booking_intents(customer_id);
CREATE INDEX IF NOT EXISTS idx_intents_vendor_slot ON public.booking_intents(vendor_type, vendor_id, scheduled_start, scheduled_end)
  WHERE status IN ('locked', 'draft');
CREATE INDEX IF NOT EXISTS idx_intents_expires ON public.booking_intents(expires_at) WHERE status = 'locked';
CREATE INDEX IF NOT EXISTS idx_appointments_vendor ON public.appointments(vendor_type, vendor_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON public.appointments(customer_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);
CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON public.transactions(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_appointment ON public.transactions(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payouts_business ON public.staff_payouts(business_id, period_start, period_end);

CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
