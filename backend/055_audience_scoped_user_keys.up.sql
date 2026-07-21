-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 055 — Audience-scoped user keys
--
-- Kshuri's identity model is *decoupled per role*: a single phone number can
-- register independently as a salon admin AND as a freelancer AND as a
-- customer — each one its own user record with no cross-visibility. The
-- platform's refresh cookies, login flows, and role-mismatch enforcement
-- already work this way; the global UNIQUE constraints on users.phone_number
-- and users.email were the last piece blocking it.
--
-- This migration:
--   1. Drops the global UNIQUE on (phone_number) and (email).
--   2. Adds composite-unique partial indexes on (phone_number, role) and
--      (email, role) — so the same value is allowed across roles but NOT
--      duplicated within a single role.
--   3. Excludes soft-deleted rows so re-signups after a hard-delete or
--      soft-delete don't clash.
--
-- Tradeoff: one person playing multiple roles has multiple distinct accounts.
-- That matches the per-role dashboard architecture. If we later want a
-- "linked identities" UX, the link metadata goes in a separate table without
-- changing this schema.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the global constraints. IF EXISTS keeps the migration idempotent on
-- environments where the original constraint may have been named differently.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_phone_number_key;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key;

-- Per-role composite uniqueness. Partial WHERE excludes soft-deleted rows so
-- a re-signup after deletion doesn't conflict with the tombstone.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_role_unique
  ON public.users (phone_number, role)
  WHERE phone_number IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_role_unique
  ON public.users (email, role)
  WHERE deleted_at IS NULL;
