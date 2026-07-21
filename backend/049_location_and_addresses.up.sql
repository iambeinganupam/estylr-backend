-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 049 — Customer address book + structured event venue
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.user_addresses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label             VARCHAR(40) NOT NULL DEFAULT 'Home',
  recipient_name    VARCHAR(120),
  contact_phone     VARCHAR(20),
  address_line1     VARCHAR(255) NOT NULL,
  address_line2     VARCHAR(255),
  landmark          VARCHAR(255),
  city              VARCHAR(100) NOT NULL,
  state             VARCHAR(100) NOT NULL,
  postal_code       VARCHAR(20),
  country_code      CHAR(2) NOT NULL DEFAULT 'IN',
  coordinates       GEOGRAPHY(POINT, 4326),
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_addresses_user ON public.user_addresses(user_id);
CREATE UNIQUE INDEX uq_user_addresses_one_default
  ON public.user_addresses (user_id) WHERE is_default = TRUE;
CREATE INDEX idx_user_addresses_geo
  ON public.user_addresses USING GIST (coordinates)
  WHERE coordinates IS NOT NULL;

CREATE TRIGGER trg_user_addresses_updated_at BEFORE UPDATE ON public.user_addresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Structured venue on event_bookings_extended
ALTER TABLE public.event_bookings_extended
  ADD COLUMN venue_address_line1 VARCHAR(255),
  ADD COLUMN venue_address_line2 VARCHAR(255),
  ADD COLUMN venue_city          VARCHAR(100),
  ADD COLUMN venue_state         VARCHAR(100),
  ADD COLUMN venue_postal_code   VARCHAR(20),
  ADD COLUMN venue_country_code  CHAR(2) DEFAULT 'IN',
  ADD COLUMN venue_coordinates   GEOGRAPHY(POINT, 4326);

CREATE INDEX idx_event_bookings_venue_geo
  ON public.event_bookings_extended USING GIST (venue_coordinates)
  WHERE venue_coordinates IS NOT NULL;

COMMENT ON TABLE public.user_addresses IS
  'Per-user saved addresses with optional geo-coords. One default per user (partial unique idx).';
