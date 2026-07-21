-- ─────────────────────────────────────────────────────────────────────────────
-- 039 — Vendor-collected payments + commission ledger + subscription plans
--
-- Phase 1 of the PRD ("Manual Payments (UPI)"). Vendors collect customer
-- payments directly via cash or a UPI deep-link / QR generated on the fly;
-- the platform earns either:
--
--   • a per-booking commission % (pay-as-you-go vendors), or
--   • a flat monthly subscription fee (subscribed vendors — commission-free).
--
-- This migration adds three concerns:
--
--   1. Vendor UPI identity            (business_accounts, freelancer_profiles)
--   2. Subscription plan catalog      (subscription_plans + seeds)
--   3. Append-only dues ledger        (vendor_dues_ledger + balance view)
--
-- The plan catalog is mutable at runtime — super admin updates commission %,
-- monthly fees and limits without a code change. Plans are referenced by
-- their stable `code` column from the application layer.
--
-- The ledger is append-only: every commission accrual, settlement payment,
-- subscription invoice, or manual adjustment is a new row with the running
-- balance snapshot. The `vendor_outstanding_balance` view returns the latest
-- snapshot per (vendor_type, vendor_id) for O(1) "how much do I owe?" reads.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Vendor UPI identity ──────────────────────────────────────────────────
-- `upi_id`           — Virtual Payment Address used to build customer-side QRs
-- `upi_display_name` — payee name shown on the UPI app's confirmation screen
-- `subscription_active_until` — end of the currently paid subscription window;
--   NULL or past => vendor is on pay-as-you-go and accrues commission.

ALTER TABLE public.business_accounts
  ADD COLUMN upi_id                   VARCHAR(255),
  ADD COLUMN upi_display_name         VARCHAR(120),
  ADD COLUMN subscription_active_until TIMESTAMPTZ;

ALTER TABLE public.freelancer_profiles
  ADD COLUMN upi_id                   VARCHAR(255),
  ADD COLUMN upi_display_name         VARCHAR(120),
  ADD COLUMN subscription_active_until TIMESTAMPTZ;

-- Validate the VPA syntax shallowly: `name@handle`. Deep validation
-- happens at the application layer because UPI handles evolve.
ALTER TABLE public.business_accounts
  ADD CONSTRAINT business_accounts_upi_id_format
  CHECK (upi_id IS NULL OR upi_id ~ '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$');

ALTER TABLE public.freelancer_profiles
  ADD CONSTRAINT freelancer_profiles_upi_id_format
  CHECK (upi_id IS NULL OR upi_id ~ '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$');

-- ── 2. Subscription plan catalog ────────────────────────────────────────────
-- `code` is the stable application-side reference. Display fields, prices
-- and limits are all editable by super admin without code changes.
--
-- `commission_percent` is a NUMERIC(5,2) (0.00–100.00). Subscribed plans
-- typically set it to 0; pay-as-you-go uses a positive value.
--
-- `included_bookings_per_month` NULL means unlimited. Enforcement of this
-- limit lives at the application layer (it requires a rolling-window count
-- against the appointments table that doesn't belong in the schema).

CREATE TABLE public.subscription_plans (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                          VARCHAR(64)  NOT NULL UNIQUE,
  display_name                  VARCHAR(120) NOT NULL,
  tagline                       TEXT,
  monthly_fee_inr               NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_percent            NUMERIC(5,2)  NOT NULL DEFAULT 0,
  included_bookings_per_month   INTEGER,                       -- NULL = unlimited
  features                      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  is_default                    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order                    INTEGER NOT NULL DEFAULT 0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_plans_active_sort
  ON public.subscription_plans (is_active, sort_order);

-- Exactly one default plan (the fallback when a vendor has no active sub).
CREATE UNIQUE INDEX idx_subscription_plans_one_default
  ON public.subscription_plans (is_default) WHERE is_default = TRUE;

CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed the four PRD plans. Prices and commission % are starting values —
-- super admin tunes them in production via UPDATE. The `pay_as_you_go` row
-- is the default; vendors land here until they upgrade.
INSERT INTO public.subscription_plans
  (code, display_name, tagline, monthly_fee_inr, commission_percent,
   included_bookings_per_month, features, is_default, sort_order)
VALUES
  ('pay_as_you_go', 'Pay as you go',
   'No monthly fee — pay per booking',
   0,    18.00, NULL,
   '["No monthly fee", "18% commission per booking", "All core features", "Email support"]'::jsonb,
   TRUE,  0),
  ('basic', 'Basic',
   'Best for new salons getting started',
   999,  0.00,  50,
   '["Up to 50 bookings/month", "Basic analytics", "2 staff accounts", "Email support"]'::jsonb,
   FALSE, 1),
  ('professional', 'Professional',
   'Most popular — for growing salons',
   2499, 0.00,  NULL,
   '["Unlimited bookings", "Advanced analytics", "10 staff accounts", "Priority support", "Freelancer management", "Custom branding"]'::jsonb,
   FALSE, 2),
  ('enterprise', 'Enterprise',
   'For multi-location chains',
   4999, 0.00,  NULL,
   '["Everything in Professional", "Unlimited staff", "API access", "Dedicated manager", "Multi-location support", "White-label solution"]'::jsonb,
   FALSE, 3);

-- ── 3. Vendor dues ledger ───────────────────────────────────────────────────
-- Append-only. Each row records a delta (positive = vendor owes platform,
-- negative = vendor paid platform) plus a running balance snapshot. The
-- balance snapshot turns "what's my balance now?" into a single LIMIT-1
-- read instead of a SUM over all history.
--
-- entry_type discriminator:
--   commission_accrual   — a customer paid via cash/upi → vendor owes us
--   settlement_payment   — vendor settled some/all of their dues → negative
--   subscription_fee     — monthly subscription invoice → vendor owes us
--   adjustment           — manual super-admin correction (+/-)
--
-- transaction_id links accrual rows to the underlying booking transaction.

CREATE TYPE vendor_dues_entry_type AS ENUM (
  'commission_accrual',
  'settlement_payment',
  'subscription_fee',
  'adjustment'
);

CREATE TABLE public.vendor_dues_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_type     vendor_type NOT NULL,                    -- enum from 003
  vendor_id       UUID NOT NULL,
  transaction_id  UUID REFERENCES public.transactions(id), -- nullable for non-accrual rows
  entry_type      vendor_dues_entry_type NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,                  -- signed: + owe, - paid
  balance_after   NUMERIC(10,2) NOT NULL,                  -- snapshot of running outstanding
  notes           TEXT,
  external_ref    VARCHAR(255),                            -- e.g. UPI txn ref when settlement is recorded
  created_by      UUID REFERENCES public.users(id),        -- super admin user for manual adjustments
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendor_dues_vendor_recent
  ON public.vendor_dues_ledger (vendor_type, vendor_id, created_at DESC);

CREATE INDEX idx_vendor_dues_transaction
  ON public.vendor_dues_ledger (transaction_id) WHERE transaction_id IS NOT NULL;

-- O(1) read view: latest balance snapshot per vendor.
-- DISTINCT ON keeps just the freshest row per (vendor_type, vendor_id).
CREATE VIEW public.vendor_outstanding_balance AS
SELECT DISTINCT ON (vendor_type, vendor_id)
  vendor_type,
  vendor_id,
  balance_after AS outstanding,
  created_at    AS as_of
FROM public.vendor_dues_ledger
ORDER BY vendor_type, vendor_id, created_at DESC;

COMMENT ON TABLE public.subscription_plans IS
  'Pricing & commission catalog. Mutable at runtime by super admin — plans are referenced by their stable `code`.';
COMMENT ON TABLE public.vendor_dues_ledger IS
  'Append-only ledger tracking commission accruals, subscription fees, and settlements. Use vendor_outstanding_balance view for current dues.';
COMMENT ON COLUMN public.vendor_dues_ledger.amount IS
  'Signed delta: positive when vendor owes platform (commission/subscription), negative when vendor paid platform (settlement).';
