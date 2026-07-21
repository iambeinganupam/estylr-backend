-- ─────────────────────────────────────────────────────────────────────────────
-- 059 — `custom_categories` feature definition
--
-- Companion to 058. The new POST /catalog/categories endpoint sits behind
-- planGuard('custom_categories'), so the entitlement system needs a feature
-- definition for that code.
--
-- Default value is `true` so every plan (pay_as_you_go, basic, professional,
-- enterprise) includes the capability today. To later restrict it to a paid
-- tier, super admin can:
--   1. UPDATE feature_definitions SET default_value = 'false' WHERE code = 'custom_categories'
--   2. INSERT plan_entitlements rows for the tiers that should keep it.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.feature_definitions (code, display_name, description, value_kind, default_value)
VALUES (
  'custom_categories',
  'Custom service categories',
  'Lets a vendor add their own categories and subcategories to the service taxonomy.',
  'boolean',
  'true'::jsonb
)
ON CONFLICT (code) DO NOTHING;
