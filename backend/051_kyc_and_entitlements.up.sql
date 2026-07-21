-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 051 — KYC submissions + dynamic plan-gating tables
--
--   * kyc_documents enum (aadhaar | pan)
--   * public.kyc_submissions — one open submission per vendor (partial unique)
--                              with automated-check results + admin decision
--   * Denormalized current_plan_code on vendor profile tables
--   * public.feature_definitions — catalog of gate-able features
--   * public.plan_entitlements — per-plan values (replaces JSONB blob)
--   * public.vendor_entitlement_overrides — surgical grants/denials
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE kyc_document_type AS ENUM ('aadhaar', 'pan');

CREATE TABLE public.kyc_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_type         vendor_type NOT NULL,
  vendor_id           UUID NOT NULL,
  user_id             UUID NOT NULL REFERENCES public.users(id),
  document_type       kyc_document_type NOT NULL,
  document_number     VARCHAR(64) NOT NULL,
  document_media_id   UUID NOT NULL REFERENCES public.media_items(id),
  selected_plan_code  VARCHAR(64) NOT NULL REFERENCES public.subscription_plans(code),
  status              VARCHAR(20) NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted','auto_passed','auto_flagged','approved','rejected')),
  auto_check_results  JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_confidence     VARCHAR(10) CHECK (auto_confidence IN ('high','medium','low')),
  auto_checked_at     TIMESTAMPTZ,
  reviewer_id         UUID REFERENCES public.users(id),
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one open submission per vendor; decided rows are historical and don't constrain.
CREATE UNIQUE INDEX uq_kyc_submissions_open_per_vendor
  ON public.kyc_submissions (vendor_type, vendor_id)
  WHERE status IN ('submitted','auto_passed','auto_flagged');

CREATE INDEX idx_kyc_submissions_status_created
  ON public.kyc_submissions(status, created_at);

CREATE INDEX idx_kyc_submissions_vendor
  ON public.kyc_submissions(vendor_type, vendor_id);

CREATE TRIGGER trg_kyc_submissions_updated_at BEFORE UPDATE ON public.kyc_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Denormalized current-plan reference on vendor profile tables
-- (read-fast: avoids joining ledger to compute current plan on every request)
ALTER TABLE public.freelancer_profiles
  ADD COLUMN current_plan_code VARCHAR(64) REFERENCES public.subscription_plans(code);

ALTER TABLE public.business_accounts
  ADD COLUMN current_plan_code VARCHAR(64) REFERENCES public.subscription_plans(code);

-- ── Dynamic plan-gating tables ──────────────────────────────────────────────

CREATE TABLE public.feature_definitions (
  code           VARCHAR(64)  PRIMARY KEY,
  display_name   VARCHAR(120) NOT NULL,
  description    TEXT,
  value_kind     VARCHAR(20)  NOT NULL CHECK (value_kind IN ('boolean','count','enum')),
  enum_values    TEXT[],
  default_value  JSONB        NOT NULL DEFAULT 'false'::jsonb,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_feature_definitions_updated_at BEFORE UPDATE ON public.feature_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE public.plan_entitlements (
  plan_code      VARCHAR(64) REFERENCES public.subscription_plans(code) ON DELETE CASCADE,
  feature_code   VARCHAR(64) REFERENCES public.feature_definitions(code) ON DELETE CASCADE,
  value          JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_code, feature_code)
);

CREATE TRIGGER trg_plan_entitlements_updated_at BEFORE UPDATE ON public.plan_entitlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE public.vendor_entitlement_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_type    vendor_type NOT NULL,
  vendor_id      UUID        NOT NULL,
  feature_code   VARCHAR(64) NOT NULL REFERENCES public.feature_definitions(code) ON DELETE CASCADE,
  value          JSONB       NOT NULL,
  reason         TEXT        NOT NULL,
  expires_at     TIMESTAMPTZ,
  created_by     UUID        NOT NULL REFERENCES public.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_type, vendor_id, feature_code)
);

-- Index on all overrides; active-only filtering (expires_at IS NULL OR expires_at > now())
-- is applied at query time — NOW() is not immutable and cannot appear in index predicates.
CREATE INDEX idx_vendor_entitlement_overrides_vendor
  ON public.vendor_entitlement_overrides (vendor_type, vendor_id);

-- ── Seed the feature catalog + per-plan values ──────────────────────────────

INSERT INTO public.feature_definitions (code, display_name, description, value_kind, default_value) VALUES
  ('max_staff',           'Maximum staff accounts',  'Cap on active staff members',                'count',   '0'::jsonb),
  ('max_services',        'Maximum services',        'Cap on services in catalog',                 'count',   '5'::jsonb),
  ('analytics',           'Analytics dashboard',     'Booking + revenue charts',                   'boolean', 'false'::jsonb),
  ('freelancer_mgmt',     'Freelancer management',   'Hire and manage freelancers',                'boolean', 'false'::jsonb),
  ('custom_branding',     'Custom branding',         'Logo + colour theme on customer pages',      'boolean', 'false'::jsonb),
  ('priority_support',    'Priority support',        'Skip the queue on support tickets',          'boolean', 'false'::jsonb),
  ('api_access',          'API access',              'Programmatic API + webhooks',                'boolean', 'false'::jsonb);

-- Seed plan-tier values matching the spec §5.2 table.
-- Pay-as-you-go and basic intentionally fall back to feature default for unspecified rows.
INSERT INTO public.plan_entitlements (plan_code, feature_code, value) VALUES
  ('pay_as_you_go', 'max_staff',        '0'::jsonb),
  ('pay_as_you_go', 'max_services',     '5'::jsonb),

  ('basic',         'max_staff',        '2'::jsonb),
  ('basic',         'max_services',     '20'::jsonb),

  ('professional',  'max_staff',        '10'::jsonb),
  ('professional',  'max_services',     'null'::jsonb),
  ('professional',  'analytics',        'true'::jsonb),
  ('professional',  'freelancer_mgmt',  'true'::jsonb),
  ('professional',  'custom_branding',  'true'::jsonb),
  ('professional',  'priority_support', 'true'::jsonb),

  ('enterprise',    'max_staff',        'null'::jsonb),
  ('enterprise',    'max_services',     'null'::jsonb),
  ('enterprise',    'analytics',        'true'::jsonb),
  ('enterprise',    'freelancer_mgmt',  'true'::jsonb),
  ('enterprise',    'custom_branding',  'true'::jsonb),
  ('enterprise',    'priority_support', 'true'::jsonb),
  ('enterprise',    'api_access',       'true'::jsonb);

COMMENT ON TABLE public.kyc_submissions IS
  'Per-vendor KYC submission (Aadhaar or PAN + plan choice). One open row at a time; decided rows retained.';
COMMENT ON TABLE public.feature_definitions IS
  'Catalog of gate-able features. value_kind drives resolver semantics. Editable at runtime by super admin.';
COMMENT ON TABLE public.plan_entitlements IS
  'Per-plan feature values. Missing rows fall back to feature_definitions.default_value.';
COMMENT ON TABLE public.vendor_entitlement_overrides IS
  'Per-vendor surgical override (highest precedence). Expires per expires_at or revoke via DELETE.';
