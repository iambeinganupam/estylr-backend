-- 016 — Add gender_target to services table
-- The column was missing from the original 004 schema but referenced in the repository.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS gender_target VARCHAR(10) NOT NULL DEFAULT 'unisex';
