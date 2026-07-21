-- TYPE: schema
-- ENV: dev-only (production must not run; see docs/MIGRATION_OPERATIONS.md)
--
-- Down migration for 011_event_manager.up.sql

DROP TRIGGER IF EXISTS trg_event_hires_updated_at ON public.event_freelancer_hires;
DROP TRIGGER IF EXISTS trg_event_bookings_updated_at ON public.event_bookings_extended;
DROP INDEX IF EXISTS idx_event_hires_event;
DROP INDEX IF EXISTS idx_event_bookings_date;
DROP INDEX IF EXISTS idx_event_bookings_manager;
DROP TABLE IF EXISTS public.event_freelancer_hires CASCADE;
DROP TABLE IF EXISTS public.event_bookings_extended CASCADE;
DROP TYPE IF EXISTS hire_status;
DROP TYPE IF EXISTS event_booking_status;

-- Remove 'event_manager' from user_role enum via the rename-and-replace pattern.
-- This is the standard Postgres approach for dropping an enum value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'event_manager'
  ) THEN
    -- 1. Delete event_manager users — they have no place in the old schema.
    DELETE FROM public.users WHERE role = 'event_manager';

    -- 2. Create new enum without 'event_manager'.
    CREATE TYPE user_role_new AS ENUM (
      'customer', 'freelancer', 'business_admin', 'staff', 'super_admin'
    );

    -- 3. Switch the column to the new type via text round-trip.
    ALTER TABLE public.users
      ALTER COLUMN role TYPE user_role_new
      USING role::text::user_role_new;

    -- 4. Drop the old type and rename.
    DROP TYPE user_role;
    ALTER TYPE user_role_new RENAME TO user_role;
  END IF;
END $$;
