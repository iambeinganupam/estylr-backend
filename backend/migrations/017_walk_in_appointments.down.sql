-- TYPE: schema
-- ENV: dev-only (production must not run; see docs/MIGRATION_OPERATIONS.md)
--
-- Down migration for 017_walk_in_appointments.up.sql
--
-- Removes walk-in support. This is destructive: walk-in rows have no
-- equivalent in the old schema and are deleted, not preserved.

-- 1. Delete walk-in rows (have no customer_id, can't satisfy old NOT NULL).
DELETE FROM public.appointments WHERE customer_id IS NULL;

-- 2. Drop the walk-in columns.
ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS booking_type,
  DROP COLUMN IF EXISTS customer_phone,
  DROP COLUMN IF EXISTS customer_name;

-- 3. Restore NOT NULL on customer_id — safe now that walk-ins are gone.
ALTER TABLE public.appointments
  ALTER COLUMN customer_id SET NOT NULL;
