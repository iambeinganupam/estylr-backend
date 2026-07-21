-- TYPE: schema
-- ENV: dev-only (production must not run; see docs/MIGRATION_OPERATIONS.md)
--
-- Down migration for 020_user_names_and_staff_roles.up.sql

ALTER TABLE public.users
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS first_name;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'staff_role' AND e.enumlabel IN ('junior_stylist', 'barber', 'receptionist')
  ) THEN
    -- Remap new roles to 'senior_stylist' (a value that existed before 020).
    -- Pre-020 values (from 003_vendors.up.sql):
    --   owner, manager, senior_stylist, stylist, apprentice, admin
    UPDATE public.staff_members
       SET role = 'senior_stylist'
     WHERE role IN ('junior_stylist', 'barber', 'receptionist');

    CREATE TYPE staff_role_new AS ENUM (
      'owner', 'manager', 'senior_stylist', 'stylist', 'apprentice', 'admin'
    );

    -- The column on staff_members is named 'role' (see 003_vendors.up.sql).
    ALTER TABLE public.staff_members
      ALTER COLUMN role TYPE staff_role_new
      USING role::text::staff_role_new;

    DROP TYPE staff_role;
    ALTER TYPE staff_role_new RENAME TO staff_role;
  END IF;
END $$;
