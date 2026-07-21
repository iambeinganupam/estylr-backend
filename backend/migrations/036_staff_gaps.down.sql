-- TYPE: schema
-- Down migration for 036_staff_gaps.up.sql
-- Removes: staff_documents table, staff_bank_details table,
--          monthly_revenue_target, monthly_booking_target, rating_target,
--          incentive_pool, base_salary, address, avatar_url, hire_date columns
--          from staff_members, and staff_member_id column + index from reviews

DROP INDEX IF EXISTS idx_reviews_staff_member_id;

ALTER TABLE public.reviews
  DROP COLUMN IF EXISTS staff_member_id;

ALTER TABLE public.staff_members
  DROP COLUMN IF EXISTS hire_date,
  DROP COLUMN IF EXISTS avatar_url,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS base_salary,
  DROP COLUMN IF EXISTS incentive_pool,
  DROP COLUMN IF EXISTS rating_target,
  DROP COLUMN IF EXISTS monthly_booking_target,
  DROP COLUMN IF EXISTS monthly_revenue_target;

DROP INDEX IF EXISTS idx_staff_documents_staff_id;

DROP TABLE IF EXISTS public.staff_bank_details CASCADE;
DROP TABLE IF EXISTS public.staff_documents CASCADE;
