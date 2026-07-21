-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 035 — Bank accounts: enforce one primary per vendor
-- ─────────────────────────────────────────────────────────────────────────────
-- The finance repository performs an upsert keyed on (vendor_id, is_primary)
-- with WHERE is_primary = TRUE, but the matching partial unique index was
-- never created. Without it the INSERT raises:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- This migration adds a partial unique index that:
--   1. Lets the existing ON CONFLICT clause work.
--   2. Guarantees at most one primary bank account per vendor at the DB level.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bank_accounts_vendor_primary
  ON public.bank_accounts (vendor_id)
  WHERE is_primary = TRUE;
