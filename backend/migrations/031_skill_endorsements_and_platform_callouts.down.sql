-- TYPE: schema
-- Down migration for 031_skill_endorsements_and_platform_callouts.up.sql
-- Removes: freelancer_skill_endorsements table, platform_callouts table,
--          bump_skill_endorsement_count function, related indexes, triggers, and seeded data

DROP TRIGGER IF EXISTS trg_skill_endorsement_count_del ON public.freelancer_skill_endorsements;
DROP TRIGGER IF EXISTS trg_skill_endorsement_count_ins ON public.freelancer_skill_endorsements;
DROP TRIGGER IF EXISTS trg_platform_callouts_updated_at ON public.platform_callouts;

DROP INDEX IF EXISTS idx_platform_callouts_context_active;
DROP INDEX IF EXISTS idx_skill_endorsements_endorser;

DROP TABLE IF EXISTS public.platform_callouts CASCADE;
DROP TABLE IF EXISTS public.freelancer_skill_endorsements CASCADE;

DROP FUNCTION IF EXISTS public.bump_skill_endorsement_count() CASCADE;
