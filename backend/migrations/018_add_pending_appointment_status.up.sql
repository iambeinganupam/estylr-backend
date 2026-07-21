-- Migration 018: Add 'pending' to appointment_status enum
-- The enum was created without 'pending' in migration 005, but the booking
-- engine inserts appointments with status 'pending' before staff confirmation.

ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'confirmed';
