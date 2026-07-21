-- TYPE: schema
-- Down migration for 008_discovery_mv.up.sql
-- Removes: mv_vendor_discovery materialized view (all indexes are dropped with it),
--          refresh_vendor_directory function, expire_stale_intents function,
--          calculate_staff_commissions function

DROP MATERIALIZED VIEW IF EXISTS public.mv_vendor_discovery CASCADE;

DROP FUNCTION IF EXISTS public.refresh_vendor_directory() CASCADE;
DROP FUNCTION IF EXISTS public.expire_stale_intents() CASCADE;
DROP FUNCTION IF EXISTS public.calculate_staff_commissions(UUID, DATE, DATE) CASCADE;
