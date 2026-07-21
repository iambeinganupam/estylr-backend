-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 013_add_soft_delete
-- Description: Add deleted_at soft-delete column to users table
-- ─────────────────────────────────────────────────────────────────────────────
-- The auth and admin repositories reference deleted_at IS NULL for soft-delete
-- filtering. This migration adds the column that was missing from 002_users_and_auth.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON public.users(deleted_at) WHERE deleted_at IS NULL;
