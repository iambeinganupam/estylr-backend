-- TYPE: schema
-- Down migration for 003_vendors.up.sql
-- Removes: staff_members, bank_accounts, salon_locations, business_accounts,
--          freelancer_profiles tables, related indexes, triggers,
--          vendor_type, staff_role, subscription_plan enums

DROP TRIGGER IF EXISTS trg_staff_updated_at ON public.staff_members;
DROP TRIGGER IF EXISTS trg_locations_updated_at ON public.salon_locations;
DROP TRIGGER IF EXISTS trg_businesses_updated_at ON public.business_accounts;
DROP TRIGGER IF EXISTS trg_freelancers_updated_at ON public.freelancer_profiles;

DROP INDEX IF EXISTS idx_locations_name_trgm;
DROP INDEX IF EXISTS idx_freelancers_name_trgm;
DROP INDEX IF EXISTS idx_staff_employer;
DROP INDEX IF EXISTS idx_locations_active;
DROP INDEX IF EXISTS idx_freelancers_active;
DROP INDEX IF EXISTS idx_locations_coordinates;
DROP INDEX IF EXISTS idx_freelancers_coordinates;

DROP TABLE IF EXISTS public.bank_accounts CASCADE;
DROP TABLE IF EXISTS public.staff_members CASCADE;
DROP TABLE IF EXISTS public.salon_locations CASCADE;
DROP TABLE IF EXISTS public.business_accounts CASCADE;
DROP TABLE IF EXISTS public.freelancer_profiles CASCADE;

DROP TYPE IF EXISTS subscription_plan;
DROP TYPE IF EXISTS staff_role;
DROP TYPE IF EXISTS vendor_type;
