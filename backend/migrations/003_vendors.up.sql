-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 003_vendors
-- Description: Freelancer profiles, business accounts, salon locations, staff
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE vendor_type AS ENUM ('freelancer', 'salon_location');
CREATE TYPE staff_role AS ENUM ('owner', 'manager', 'senior_stylist', 'stylist', 'apprentice', 'admin');
CREATE TYPE subscription_plan AS ENUM ('free', 'starter', 'professional', 'enterprise');

-- ── Freelancer Profiles ──
CREATE TABLE public.freelancer_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  business_name     VARCHAR(200) NOT NULL,
  display_name      VARCHAR(200),
  bio               TEXT,
  logo_url          VARCHAR(500),
  coordinates       GEOGRAPHY(POINT, 4326),
  address_line1     VARCHAR(255),
  city              VARCHAR(100),
  state             VARCHAR(100),
  postal_code       VARCHAR(20),
  country_code      CHAR(2) NOT NULL DEFAULT 'IN',
  contact_phone     VARCHAR(20),
  category          VARCHAR(100),
  gender_preference VARCHAR(20),
  is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  avg_rating        NUMERIC(3,2) NOT NULL DEFAULT 0.0,
  review_count      INTEGER NOT NULL DEFAULT 0,
  starting_price    NUMERIC(10,2),
  commission_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Business Accounts ──
CREATE TABLE public.business_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         UUID NOT NULL REFERENCES public.users(id),
  legal_business_name   VARCHAR(255) NOT NULL,
  brand_name            VARCHAR(200),
  tax_id_number         VARCHAR(50),
  subscription_plan     subscription_plan NOT NULL DEFAULT 'free',
  subscription_expires  TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  stripe_customer_id    VARCHAR(255),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Salon Locations ──
CREATE TABLE public.salon_locations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id   UUID NOT NULL REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  display_name          VARCHAR(200) NOT NULL,
  url_slug              VARCHAR(255) UNIQUE,
  address_line1         VARCHAR(255),
  address_line2         VARCHAR(255),
  city                  VARCHAR(100),
  state                 VARCHAR(100),
  postal_code           VARCHAR(20),
  country_code          CHAR(2) NOT NULL DEFAULT 'IN',
  coordinates           GEOGRAPHY(POINT, 4326),
  contact_phone         VARCHAR(20),
  contact_email         VARCHAR(255),
  gender_preference     VARCHAR(20),
  logo_url              VARCHAR(500),
  cover_url             VARCHAR(500),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified           BOOLEAN NOT NULL DEFAULT FALSE,
  avg_rating            NUMERIC(3,2) NOT NULL DEFAULT 0.0,
  review_count          INTEGER NOT NULL DEFAULT 0,
  starting_price        NUMERIC(10,2),
  category              VARCHAR(100),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Staff Members ──
CREATE TABLE public.staff_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.users(id),
  employer_id           UUID NOT NULL REFERENCES public.salon_locations(id) ON DELETE CASCADE,
  role                  staff_role NOT NULL DEFAULT 'stylist',
  commission_percentage NUMERIC(5,2) NOT NULL DEFAULT 40.0,
  hire_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  invited_at            TIMESTAMPTZ,
  accepted_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, employer_id)
);

-- ── Bank Accounts ──
CREATE TABLE public.bank_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id             UUID NOT NULL,
  bank_name             VARCHAR(100) NOT NULL,
  account_number        VARCHAR(30) NOT NULL,
  ifsc_code             VARCHAR(15) NOT NULL,
  account_holder_name   VARCHAR(100) NOT NULL,
  is_primary            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── GiST Spatial Indexes ──
CREATE INDEX IF NOT EXISTS idx_freelancers_coordinates ON public.freelancer_profiles USING GIST(coordinates);
CREATE INDEX IF NOT EXISTS idx_locations_coordinates ON public.salon_locations USING GIST(coordinates);
CREATE INDEX IF NOT EXISTS idx_freelancers_active ON public.freelancer_profiles(is_active, is_verified, city);
CREATE INDEX IF NOT EXISTS idx_locations_active ON public.salon_locations(is_active, is_verified, city);
CREATE INDEX IF NOT EXISTS idx_staff_employer ON public.staff_members(employer_id) WHERE is_active = TRUE;

-- Trigram index for fuzzy name search
CREATE INDEX IF NOT EXISTS idx_freelancers_name_trgm ON public.freelancer_profiles USING GIN(display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_locations_name_trgm ON public.salon_locations USING GIN(display_name gin_trgm_ops);

-- Timestamps triggers
CREATE TRIGGER trg_freelancers_updated_at BEFORE UPDATE ON public.freelancer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON public.business_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON public.salon_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
