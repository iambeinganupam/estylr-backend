-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 033 — Salon→Freelancer Assignments + Discovery Presence Columns
-- ─────────────────────────────────────────────────────────────────────────────
-- This migration introduces the salon-books-freelancer feature and brings the
-- discovery materialized view in step with the presence model (032).
--
-- Two concerns travel together because they share the assignment domain:
--   1. New ENUM `assignment_status` and table `salon_freelancer_assignments`,
--      modelling salon-initiated gigs to freelancers (distinct from
--      customer→freelancer appointments).
--   2. The `mv_vendor_discovery` materialized view is rebuilt to expose
--      is_open_to_work + online_since_at so search results can show real
--      online status.
--   3. New `notification_type` enum values let the assignment service emit
--      semantically clean notifications on each transition.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Notification type enum extension ─────────────────────────────────────
-- ALTER TYPE ADD VALUE cannot run inside a transaction in PostgreSQL <12,
-- but our migrate script already executes each file in its own implicit txn.
-- Using IF NOT EXISTS makes the migration idempotent.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'assignment_requested';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'assignment_accepted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'assignment_declined';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'assignment_started';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'assignment_completed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'assignment_cancelled';

-- ─── 2. assignment_status enum ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_status') THEN
    CREATE TYPE assignment_status AS ENUM (
      'requested',
      'accepted',
      'in_progress',
      'completed',
      'declined',
      'cancelled'
    );
  END IF;
END $$;

-- ─── 3. salon_freelancer_assignments ─────────────────────────────────────────
-- Each row is one gig request: salon X asks freelancer Y to come work between
-- start_time and end_time, for proposed_amount. The state machine in
-- src/lib/state-machine.ts (ASSIGNMENT_TRANSITIONS) governs allowed actions.
CREATE TABLE IF NOT EXISTS public.salon_freelancer_assignments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parties --
  business_id        UUID NOT NULL REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  salon_location_id  UUID NOT NULL REFERENCES public.salon_locations(id)   ON DELETE CASCADE,
  freelancer_id      UUID NOT NULL REFERENCES public.freelancer_profiles(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id),

  -- Gig details --
  service_category   VARCHAR(100),
  notes              TEXT,
  start_time         TIMESTAMPTZ NOT NULL,
  end_time           TIMESTAMPTZ NOT NULL,
  proposed_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Lifecycle --
  status             assignment_status NOT NULL DEFAULT 'requested',
  decline_reason     TEXT,
  cancel_reason      TEXT,
  responded_at       TIMESTAMPTZ,   -- when freelancer accepted / declined
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancelled_by       UUID REFERENCES public.users(id),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT salon_freelancer_assignments_time_range
    CHECK (end_time > start_time),
  CONSTRAINT salon_freelancer_assignments_amount_nonneg
    CHECK (proposed_amount >= 0)
);

-- Hot paths.
-- Freelancer's incoming + history view, ordered by recency.
CREATE INDEX IF NOT EXISTS idx_assignments_freelancer
  ON public.salon_freelancer_assignments (freelancer_id, status, start_time DESC);

-- Salon's outgoing list, scoped by business.
CREATE INDEX IF NOT EXISTS idx_assignments_business
  ON public.salon_freelancer_assignments (business_id, status, start_time DESC);

-- For the "is freelancer free at time T" check (planned availability calc).
CREATE INDEX IF NOT EXISTS idx_assignments_freelancer_window
  ON public.salon_freelancer_assignments (freelancer_id, start_time, end_time)
  WHERE status IN ('requested', 'accepted', 'in_progress');

CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON public.salon_freelancer_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE public.salon_freelancer_assignments IS
  'Gigs: a salon (business_admin) requesting a freelancer to work for a defined time window. State transitions are governed by ASSIGNMENT_TRANSITIONS in src/lib/state-machine.ts.';

-- ─── 4. Discovery materialized view: include presence columns ────────────────
-- Drops and recreates the view to add is_open_to_work + online_since_at.
DROP MATERIALIZED VIEW IF EXISTS public.mv_vendor_discovery;

CREATE MATERIALIZED VIEW public.mv_vendor_discovery AS
SELECT
  fp.id,
  'freelancer'::text                            AS vendor_type,
  fp.business_name,
  COALESCE(fp.display_name, fp.business_name)   AS display_name,
  fp.logo_url,
  fp.coordinates,
  fp.city, fp.state, fp.country_code,
  fp.avg_rating, fp.review_count,
  fp.starting_price,
  fp.category, fp.gender_preference,
  fp.is_active, fp.is_verified,
  fp.is_open_to_work,
  fp.online_since_at,
  fp.updated_at
FROM public.freelancer_profiles fp
WHERE fp.is_active = TRUE AND fp.is_verified = TRUE
UNION ALL
SELECT
  sl.id,
  'salon_location'::text                        AS vendor_type,
  ba.brand_name                                 AS business_name,
  sl.display_name,
  sl.logo_url,
  sl.coordinates,
  sl.city, sl.state, sl.country_code,
  sl.avg_rating, sl.review_count,
  sl.starting_price,
  sl.category, sl.gender_preference,
  sl.is_active, sl.is_verified,
  TRUE          AS is_open_to_work,   -- Salons are always "open" in this column
  NULL::timestamptz AS online_since_at,
  sl.updated_at
FROM public.salon_locations sl
JOIN public.business_accounts ba ON sl.business_account_id = ba.id
WHERE sl.is_active = TRUE AND sl.is_verified = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_vendor_discovery_pk
  ON public.mv_vendor_discovery (vendor_type, id);

CREATE INDEX IF NOT EXISTS idx_mv_vendor_discovery_geo
  ON public.mv_vendor_discovery USING GIST (coordinates);

CREATE INDEX IF NOT EXISTS idx_mv_vendor_discovery_rating
  ON public.mv_vendor_discovery (avg_rating DESC);

REFRESH MATERIALIZED VIEW public.mv_vendor_discovery;
