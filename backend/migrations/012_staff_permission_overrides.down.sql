-- TYPE: schema
-- Down migration for 012_staff_permission_overrides.up.sql
-- Removes: staff_permission_overrides table and its index

DROP INDEX IF EXISTS idx_perm_overrides_staff;

DROP TABLE IF EXISTS public.staff_permission_overrides CASCADE;
