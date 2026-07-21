-- 017 — Support walk-in appointments (no customer account required)
-- Allows business_admin to create appointments directly for walk-in customers.

ALTER TABLE public.appointments
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS customer_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS booking_type   VARCHAR(20) NOT NULL DEFAULT 'online';
