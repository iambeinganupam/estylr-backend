-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020 — Add user name columns + align staff_role enum
-- ─────────────────────────────────────────────────────────────────────────────

-- Add first_name / last_name to users (referenced by staff invite + list queries)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS first_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_name   VARCHAR(100);

-- Extend staff_role enum with roles used in the UI
-- PostgreSQL requires ADD VALUE outside a transaction block,
-- so each is guarded by a DO block that checks first.
DO $$ BEGIN
  ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'junior_stylist';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'barber';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'receptionist';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
