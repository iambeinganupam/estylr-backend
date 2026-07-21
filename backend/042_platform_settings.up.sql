-- ─────────────────────────────────────────────────────────────────────────────
-- 042 — Platform settings: single-row config table
--
-- The previous /admin/settings endpoint returned a hardcoded JSON object.
-- This migration creates a real table so the super admin can edit values
-- without a code change. The table is locked to a single row by a
-- CHECK on a sentinel `id` column — every UPSERT targets the same row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.platform_settings (
  id                  TEXT PRIMARY KEY DEFAULT 'singleton'
                       CHECK (id = 'singleton'),

  -- Commercial
  default_commission  NUMERIC(5,2)  NOT NULL DEFAULT 18.00,
  gst_rate            NUMERIC(5,2)  NOT NULL DEFAULT 18.00,
  currency            CHAR(3)       NOT NULL DEFAULT 'INR',
  payout_cycle        VARCHAR(32)   NOT NULL DEFAULT 'weekly',

  -- KYC
  kyc_required_docs   JSONB         NOT NULL DEFAULT '["aadhaar","pan"]'::jsonb,
  kyc_auto_expiry_days INTEGER      NOT NULL DEFAULT 365,

  -- Catalog
  default_category_id UUID REFERENCES public.service_categories(id),
  max_services_per_vendor INTEGER  NOT NULL DEFAULT 100,

  -- Feature flags (free-form key → bool map)
  feature_flags       JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Branding / generic
  platform_name       VARCHAR(120)  NOT NULL DEFAULT 'Kshuri',
  timezone            VARCHAR(64)   NOT NULL DEFAULT 'Asia/Kolkata',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed the singleton row.
INSERT INTO public.platform_settings (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.platform_settings IS
  'Single-row platform configuration. Locked to id = ''singleton'' by a CHECK; every write is an UPSERT.';
