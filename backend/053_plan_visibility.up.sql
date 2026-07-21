-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 053 — Plan public selectability
--
-- Adds a tri-state-friendly visibility flag to subscription_plans so admins
-- can:
--   • Show a plan and let vendors pick it          → is_active=TRUE, is_publicly_selectable=TRUE
--   • Show it on the picker but disabled / "Coming soon"  → is_active=TRUE, is_publicly_selectable=FALSE
--   • Hide it entirely                             → is_active=FALSE
--
-- We default to FALSE on rollout so paid plans don't accidentally become
-- live without an admin explicitly enabling them. We then opt the free plan
-- (price 0) IN, since that's the only plan publicly selectable today.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS is_publicly_selectable BOOLEAN NOT NULL DEFAULT FALSE;

-- Free plans (₹0/month) ship selectable so vendors can finish KYC + onboarding.
UPDATE public.subscription_plans
SET is_publicly_selectable = TRUE
WHERE monthly_fee_inr = 0 AND is_active = TRUE;
