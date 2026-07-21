-- backend/migrations/010_staff_attendance.up.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 010_staff_attendance
-- Description: Clock in/out attendance records for salon staff
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.staff_attendance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id  UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  clock_in_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out_at     TIMESTAMPTZ,
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_clock_order CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at)
);

CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON public.staff_attendance(staff_member_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_open ON public.staff_attendance(staff_member_id)
  WHERE clock_out_at IS NULL;
