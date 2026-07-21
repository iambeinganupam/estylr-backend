-- TYPE: schema
-- Down migration for 013_add_soft_delete.up.sql
-- Removes: deleted_at column and its index from users table

DROP INDEX IF EXISTS idx_users_deleted_at;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS deleted_at;
