-- TYPE: schema
-- Down migration for 023_appointment_total_and_notes.up.sql
-- Removes: total_amount, notes columns and appointments_customer_identity_check
--          constraint from appointments table

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_customer_identity_check;

ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS total_amount;
