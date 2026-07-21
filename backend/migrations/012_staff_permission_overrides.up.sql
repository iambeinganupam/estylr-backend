-- backend/migrations/012_staff_permission_overrides.up.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 012_staff_permission_overrides
-- Description: Per-staff-per-salon RBAC overrides — read by AbilityFactory in Phase 2
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.staff_permission_overrides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id     UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  salon_location_id   UUID NOT NULL REFERENCES public.salon_locations(id) ON DELETE CASCADE,
  action              TEXT NOT NULL,   -- e.g. 'read', 'update', 'delete'
  subject             TEXT NOT NULL,   -- e.g. 'Appointment', 'Report'
  granted             BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (staff_member_id, salon_location_id, action, subject)
);

CREATE INDEX IF NOT EXISTS idx_perm_overrides_staff ON public.staff_permission_overrides(staff_member_id, salon_location_id);
