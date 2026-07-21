-- TYPE: schema
-- Down migration for 004_catalog_and_availability.up.sql
-- Removes: shift_schedules, time_blocks, working_hours, staff_service_overrides,
--          services, service_categories tables, related indexes, triggers,
--          shift_type enum

DROP TRIGGER IF EXISTS trg_shifts_updated_at ON public.shift_schedules;
DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;

DROP INDEX IF EXISTS idx_shifts_staff_date;
DROP INDEX IF EXISTS idx_time_blocks_target_range;
DROP INDEX IF EXISTS idx_working_hours_target;
DROP INDEX IF EXISTS idx_services_vendor;

DROP TABLE IF EXISTS public.shift_schedules CASCADE;
DROP TABLE IF EXISTS public.time_blocks CASCADE;
DROP TABLE IF EXISTS public.working_hours CASCADE;
DROP TABLE IF EXISTS public.staff_service_overrides CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;
DROP TABLE IF EXISTS public.service_categories CASCADE;

DROP TYPE IF EXISTS shift_type;
