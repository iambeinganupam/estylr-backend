-- TYPE: seed-dev
-- Down migration for 037_e2e_test_seeds.up.sql
-- Removes: E2E test seed data inserted by the up migration
-- Deletes staff_members row first (FK dependency), then the user

DELETE FROM public.staff_members
WHERE user_id = 'a0000000-0000-0000-0000-000000000004'
  AND employer_id = 'cb2b648b-74ce-40f9-9346-c5b1e2d3ab73';

DELETE FROM public.users
WHERE id = 'a0000000-0000-0000-0000-000000000004';
