-- TYPE: schema
-- ENV: dev-only (production must not run; see docs/MIGRATION_OPERATIONS.md)
--
-- Down migration for 018_add_pending_appointment_status.up.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'appointment_status' AND e.enumlabel = 'pending'
  ) THEN
    -- Remap pending appointments to 'confirmed' (the pre-018 default).
    UPDATE public.appointments SET status = 'confirmed' WHERE status = 'pending';

    -- Pre-018 enum values (from 005_booking_engine.up.sql):
    --   confirmed, in_progress, completed, cancelled, no_show
    CREATE TYPE appointment_status_new AS ENUM (
      'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
    );

    ALTER TABLE public.appointments
      ALTER COLUMN status TYPE appointment_status_new
      USING status::text::appointment_status_new;

    DROP TYPE appointment_status;
    ALTER TYPE appointment_status_new RENAME TO appointment_status;
  END IF;
END $$;
