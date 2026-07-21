-- TYPE: schema
-- Down migration for 010_staff_attendance.up.sql
-- Removes: staff_attendance table and its indexes

DROP INDEX IF EXISTS idx_attendance_open;
DROP INDEX IF EXISTS idx_attendance_staff_date;

DROP TABLE IF EXISTS public.staff_attendance CASCADE;
