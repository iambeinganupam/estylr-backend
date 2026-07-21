-- TYPE: seed-dev
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 037 — E2E / Dev Test Seeds
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent seed data for local development and E2E test runs.
-- Creates deterministic test accounts for each dashboard role so that
-- .env.test credentials always resolve to a known, active user.
--
-- Passwords (bcrypt cost 12):
--   Staff      (meera.stylist@luxebarber.com)   → Staff123!
--   Freelancer (priya.artist@test.com)          → Freelancer123!
--   Salon E2E  (e2e-salon@kshuri.test)          → E2eTest@2026!
--
-- UUIDs use the a0000000-0000-0000-0000-00000000000N namespace so they
-- are easily grep-able and never collide with real UUIDs.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Staff test account — meera.stylist@luxebarber.com ─────────────────────

INSERT INTO public.users (
  id, email, first_name, last_name, password_hash, role, is_active
)
VALUES (
  'a0000000-0000-0000-0000-000000000004',
  'meera.stylist@luxebarber.com',
  'Meera',
  'Sharma',
  -- bcrypt(Staff123!, cost=12)
  '$2a$12$tDW9AgSXokSe0QXa/CzhMOzqIGEL/YMfvhntX5fmZ4TeTGePmnXYu',
  'staff',
  TRUE
)
ON CONFLICT (id) DO UPDATE
  SET first_name    = EXCLUDED.first_name,
      last_name     = EXCLUDED.last_name,
      password_hash = EXCLUDED.password_hash,
      role          = EXCLUDED.role,
      is_active     = TRUE;

-- Link to Luxe Barber Flagship (cb2b648b-74ce-40f9-9346-c5b1e2d3ab73)
-- Conflict key: (user_id, employer_id) — see staff_members_user_id_employer_id_key
INSERT INTO public.staff_members (
  user_id,
  employer_id,
  role,
  commission_percentage,
  is_active,
  monthly_revenue_target,
  monthly_booking_target,
  rating_target,
  incentive_pool
)
VALUES (
  'a0000000-0000-0000-0000-000000000004',
  'cb2b648b-74ce-40f9-9346-c5b1e2d3ab73',  -- Luxe Barber Flagship
  'senior_stylist',
  25.00,
  TRUE,
  80000.00,
  80,
  4.50,
  5000.00
)
ON CONFLICT (user_id, employer_id) DO UPDATE
  SET is_active              = TRUE,
      commission_percentage  = EXCLUDED.commission_percentage,
      monthly_revenue_target = EXCLUDED.monthly_revenue_target,
      monthly_booking_target = EXCLUDED.monthly_booking_target,
      rating_target          = EXCLUDED.rating_target,
      incentive_pool         = EXCLUDED.incentive_pool;
