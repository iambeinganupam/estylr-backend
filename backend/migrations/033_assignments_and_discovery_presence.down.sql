-- TYPE: schema
-- ENV: dev-only (production must not run; see docs/MIGRATION_OPERATIONS.md)
--
-- Down migration for 033_assignments_and_discovery_presence.up.sql
-- Removes: salon_freelancer_assignments table, rebuilt mv_vendor_discovery
--          (restores the 008 version without presence columns), assignment_status enum,
--          and assignment_* notification_type enum values.

DROP TRIGGER IF EXISTS trg_assignments_updated_at ON public.salon_freelancer_assignments;

DROP INDEX IF EXISTS idx_assignments_freelancer_window;
DROP INDEX IF EXISTS idx_assignments_business;
DROP INDEX IF EXISTS idx_assignments_freelancer;

DROP TABLE IF EXISTS public.salon_freelancer_assignments CASCADE;

-- Drop the presence-aware materialized view.
DROP MATERIALIZED VIEW IF EXISTS public.mv_vendor_discovery CASCADE;

-- Restore the original mv_vendor_discovery (without presence columns) from 008.
-- NOTE: requires freelancer_profiles and salon_locations to still exist.
CREATE MATERIALIZED VIEW public.mv_vendor_discovery AS
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_vendor_discovery_id ON public.mv_vendor_discovery(id, vendor_type);
CREATE INDEX IF NOT EXISTS idx_mv_vendor_coordinates ON public.mv_vendor_discovery USING GIST(coordinates);
CREATE INDEX IF NOT EXISTS idx_mv_vendor_rating ON public.mv_vendor_discovery(avg_rating DESC);
CREATE INDEX IF NOT EXISTS idx_mv_vendor_category ON public.mv_vendor_discovery(category);
CREATE INDEX IF NOT EXISTS idx_mv_vendor_city ON public.mv_vendor_discovery(city);

-- Remove assignment_status enum (no rows use it after the table is dropped).
DROP TYPE IF EXISTS assignment_status;

-- Remove assignment_* notification_type values via rename-and-replace.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type' AND e.enumlabel LIKE 'assignment_%'
  ) THEN
    -- Delete notifications that reference assignment_* types (the feature is gone).
    DELETE FROM public.notifications WHERE type::text LIKE 'assignment_%';

    -- Recreate notification_type without assignment_* values.
    -- Pre-033 canonical values (from 006_engagement_and_media.up.sql):
    CREATE TYPE notification_type_new AS ENUM (
      'booking_confirmed', 'booking_cancelled', 'booking_completed',
      'review_received', 'payment_received', 'payout_processed',
      'promotional', 'system'
    );

    ALTER TABLE public.notifications
      ALTER COLUMN type TYPE notification_type_new
      USING type::text::notification_type_new;

    DROP TYPE notification_type;
    ALTER TYPE notification_type_new RENAME TO notification_type;
  END IF;
END $$;
