-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 023_appointment_total_and_notes
-- Description:
--   1. Adds `total_amount` snapshot column to appointments (sum of line items
--      at booking time). Required for calendar/analytics revenue display and
--      avoids JOIN-aggregate on every list query.
--   2. Adds `notes` column for walk-in special requests / staff annotations.
--   3. Adds a CHECK constraint enforcing that every appointment has either a
--      registered customer (customer_id) or a walk-in identity
--      (booking_type='walkin' AND customer_name IS NOT NULL). Defense-in-depth
--      for the application-layer Zod validation.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes        TEXT;

-- Backfill total_amount from existing appointment_line_items where present.
UPDATE public.appointments a
SET total_amount = COALESCE(sums.total, 0)
FROM (
  SELECT appointment_id, SUM(locked_price) AS total
  FROM public.appointment_line_items
  GROUP BY appointment_id
) sums
WHERE a.id = sums.appointment_id
  AND a.total_amount = 0;

-- Integrity: an appointment must identify its customer one way or the other.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_customer_identity_check'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_customer_identity_check
      CHECK (
        customer_id IS NOT NULL
        OR (booking_type = 'walkin' AND customer_name IS NOT NULL)
      );
  END IF;
END$$;
