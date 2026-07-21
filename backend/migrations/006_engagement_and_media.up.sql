-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 006_engagement_and_media
-- Description: Reviews, favorites, notifications, media portfolio
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Reviews ──
CREATE TABLE public.reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES public.users(id),
  vendor_type     VARCHAR(20) NOT NULL,
  vendor_id       UUID NOT NULL,
  appointment_id  UUID NOT NULL UNIQUE REFERENCES public.appointments(id),
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  vendor_reply    TEXT,
  vendor_reply_at TIMESTAMPTZ,
  is_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Favorites ──
CREATE TABLE public.favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vendor_type VARCHAR(20) NOT NULL,
  vendor_id   UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, vendor_type, vendor_id)
);

-- ── Notifications ──
CREATE TYPE notification_type AS ENUM (
  'booking_confirmed', 'booking_cancelled', 'booking_completed',
  'review_received', 'payment_received', 'payout_processed',
  'promotional', 'system'
);

CREATE TABLE public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB,            -- Metadata (appointment_id, etc.)
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Portfolio Media ──
CREATE TYPE media_type AS ENUM ('portfolio', 'before_after', 'profile', 'cover');

CREATE TABLE public.media_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_type VARCHAR(20) NOT NULL,
  vendor_id   UUID NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.users(id),
  file_url    VARCHAR(1000) NOT NULL,
  file_key    VARCHAR(500) NOT NULL,   -- Storage path (for deletion)
  mime_type   VARCHAR(100) NOT NULL,
  file_size   INTEGER NOT NULL,        -- Bytes
  title       VARCHAR(200),
  description TEXT,
  caption     VARCHAR(200),
  media_type  media_type NOT NULL DEFAULT 'portfolio',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_public   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_reviews_vendor ON public.reviews(vendor_type, vendor_id, created_at DESC)
  WHERE is_visible = TRUE;
CREATE INDEX IF NOT EXISTS idx_reviews_customer ON public.reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_favorites_customer ON public.favorites(customer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_vendor ON public.media_items(vendor_type, vendor_id, sort_order)
  WHERE is_public = TRUE;

-- ── Trigger: Update vendor rating denormalized counter ──
-- Keeps avg_rating + review_count fresh without heavy JOIN queries
CREATE OR REPLACE FUNCTION refresh_vendor_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_avg NUMERIC;
  v_count INTEGER;
BEGIN
  SELECT AVG(rating)::NUMERIC(3,2), COUNT(*) INTO v_avg, v_count
  FROM public.reviews
  WHERE vendor_type = COALESCE(NEW.vendor_type, OLD.vendor_type)
    AND vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id)
    AND is_visible = TRUE;

  IF COALESCE(NEW.vendor_type, OLD.vendor_type) = 'freelancer' THEN
    UPDATE public.freelancer_profiles
    SET avg_rating = COALESCE(v_avg, 0), review_count = v_count, updated_at = NOW()
    WHERE id = COALESCE(NEW.vendor_id, OLD.vendor_id);
  ELSE
    UPDATE public.salon_locations
    SET avg_rating = COALESCE(v_avg, 0), review_count = v_count, updated_at = NOW()
    WHERE id = COALESCE(NEW.vendor_id, OLD.vendor_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_refresh_rating
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION refresh_vendor_rating();

CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_media_updated_at BEFORE UPDATE ON public.media_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
