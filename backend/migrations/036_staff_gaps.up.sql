-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 036 — Staff Dashboard Gap-Fill
-- ─────────────────────────────────────────────────────────────────────────────
-- Fills the gaps identified in the staff dashboard architecture review:
--   1. staff_documents         — KYC / ID upload records per staff member
--   2. staff_bank_details      — payout bank account per staff member
--   3. staff_members columns   — monthly targets + base_salary + avatar_url + address
--   4. reviews.staff_member_id — enables staff-level reviews (distinct from salon reviews)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Staff Documents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_documents (
  id               UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_member_id  UUID         NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  document_type    VARCHAR(50)  NOT NULL,
  document_number  VARCHAR(100),
  file_url         VARCHAR(500),
  status           VARCHAR(20)  NOT NULL DEFAULT 'not_uploaded'
                     CHECK (status IN ('not_uploaded', 'pending', 'verified', 'rejected')),
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (staff_member_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_staff_documents_staff_id
  ON public.staff_documents (staff_member_id);

-- ── 2. Staff Bank Details ────────────────────────────────────────────────────
-- One active bank account per staff member for payout settlement.
CREATE TABLE IF NOT EXISTS public.staff_bank_details (
  id               UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_member_id  UUID         NOT NULL UNIQUE REFERENCES public.staff_members(id) ON DELETE CASCADE,
  bank_name        VARCHAR(150) NOT NULL,
  account_holder   VARCHAR(150) NOT NULL,
  account_number   VARCHAR(30)  NOT NULL,
  ifsc_code        VARCHAR(12)  NOT NULL,
  is_verified      BOOLEAN      NOT NULL DEFAULT FALSE,
  payment_mode     VARCHAR(30)  NOT NULL DEFAULT 'bank_transfer',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 3. Monthly Targets + Profile Fields on staff_members ─────────────────────
-- Replaces the hardcoded constants in staff.repository.ts.
ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS monthly_revenue_target  DECIMAL(10,2) NOT NULL DEFAULT 80000.00,
  ADD COLUMN IF NOT EXISTS monthly_booking_target  INT           NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS rating_target           DECIMAL(3,2)  NOT NULL DEFAULT 4.50,
  ADD COLUMN IF NOT EXISTS incentive_pool          DECIMAL(10,2) NOT NULL DEFAULT 5000.00,
  ADD COLUMN IF NOT EXISTS base_salary             DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS address                 TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url              VARCHAR(500),
  ADD COLUMN IF NOT EXISTS hire_date               DATE;

-- ── 4. Staff-level Reviews ───────────────────────────────────────────────────
-- Adds an optional FK so customers can leave a review for a specific staff
-- member (not just the salon). NULL = review is for the salon/vendor only.
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS staff_member_id  UUID REFERENCES public.staff_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_staff_member_id
  ON public.reviews (staff_member_id)
  WHERE staff_member_id IS NOT NULL;
