-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 008_discovery_mv
-- Description: Materialized view for fast geo-spatial vendor search
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Unified Vendor Discovery Materialized View ──
-- Merges freelancers + salon_locations into a single queryable surface.
-- Refreshed by cron (every 15m) or triggered on vendor profile update.
-- Supports CONCURRENTLY refresh (non-blocking).
CREATE MATERIALIZED VIEW public.mv_vendor_discovery AS
  -- Freelancers
  SELECT
    fp.id,
    'freelancer'::TEXT AS vendor_type,
    fp.business_name,
    COALESCE(fp.display_name, fp.business_name) AS display_name,
    fp.logo_url,
    fp.coordinates,
    fp.city,
    fp.state,
    fp.country_code,
    fp.avg_rating,
    fp.review_count,
    fp.starting_price,
    fp.category,
    fp.gender_preference,
    fp.is_active,
    fp.is_verified,
    fp.updated_at
  FROM public.freelancer_profiles fp
  WHERE fp.is_active = TRUE AND fp.is_verified = TRUE

  UNION ALL

  -- Salon Locations
  SELECT
    sl.id,
    'salon_location'::TEXT AS vendor_type,
    ba.brand_name AS business_name,
    sl.display_name,
    sl.logo_url,
    sl.coordinates,
    sl.city,
    sl.state,
    sl.country_code,
    sl.avg_rating,
    sl.review_count,
    sl.starting_price,
    sl.category,
    sl.gender_preference,
    sl.is_active,
    sl.is_verified,
    sl.updated_at
  FROM public.salon_locations sl
  JOIN public.business_accounts ba ON sl.business_account_id = ba.id
  WHERE sl.is_active = TRUE AND sl.is_verified = TRUE
WITH DATA;

-- ── Unique index (required for CONCURRENTLY refresh) ──
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_vendor_discovery_id ON public.mv_vendor_discovery(id, vendor_type);

-- ── GiST spatial index on the MV for fast ST_DWithin queries ──
CREATE INDEX IF NOT EXISTS idx_mv_vendor_coordinates ON public.mv_vendor_discovery USING GIST(coordinates);

-- ── Support filters ──
CREATE INDEX IF NOT EXISTS idx_mv_vendor_rating ON public.mv_vendor_discovery(avg_rating DESC);
CREATE INDEX IF NOT EXISTS idx_mv_vendor_category ON public.mv_vendor_discovery(category);
CREATE INDEX IF NOT EXISTS idx_mv_vendor_city ON public.mv_vendor_discovery(city);

-- ── RPC: Refresh the MV (called by Node cron every 15 min) ──
CREATE OR REPLACE FUNCTION public.refresh_vendor_directory()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vendor_discovery;
END; $$;

-- ── RPC: Expire stale booking intents (called by Node cron every 1 min) ──
CREATE OR REPLACE FUNCTION public.expire_stale_intents()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE expired_count INTEGER;
BEGIN
  UPDATE public.booking_intents
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'locked' AND expires_at < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END; $$;

-- ── RPC: Staff commission calculation ──
CREATE OR REPLACE FUNCTION public.calculate_staff_commissions(
  p_location_id UUID,
  p_start DATE,
  p_end DATE
)
RETURNS TABLE (
  staff_id UUID,
  appointments_count BIGINT,
  gross_generated NUMERIC,
  commission_owed NUMERIC
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    sm.id AS staff_id,
    COUNT(a.id) AS appointments_count,
    COALESCE(SUM(t.amount), 0) AS gross_generated,
    COALESCE(SUM(t.amount * sm.commission_percentage / 100), 0) AS commission_owed
  FROM public.staff_members sm
  LEFT JOIN public.appointments a ON a.staff_member_id = sm.id
    AND a.status = 'completed'
    AND a.start_time::DATE BETWEEN p_start AND p_end
  LEFT JOIN public.transactions t ON t.appointment_id = a.id AND t.status = 'completed'
  WHERE sm.employer_id = p_location_id AND sm.is_active = TRUE
  GROUP BY sm.id;
END; $$;
