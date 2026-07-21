-- TYPE: schema
-- Down migration for 005_booking_engine.up.sql
-- Removes: staff_payouts, transactions, appointment_line_items, appointments,
--          intent_line_items, booking_intents tables, related indexes, triggers,
--          payout_status, transaction_status, payment_method, appointment_status, intent_status enums

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;

DROP INDEX IF EXISTS idx_payouts_business;
DROP INDEX IF EXISTS idx_transactions_appointment;
DROP INDEX IF EXISTS idx_transactions_vendor;
DROP INDEX IF EXISTS idx_appointments_status;
DROP INDEX IF EXISTS idx_appointments_customer;
DROP INDEX IF EXISTS idx_appointments_vendor;
DROP INDEX IF EXISTS idx_intents_expires;
DROP INDEX IF EXISTS idx_intents_vendor_slot;
DROP INDEX IF EXISTS idx_intents_customer;

DROP TABLE IF EXISTS public.staff_payouts CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.appointment_line_items CASCADE;
DROP TABLE IF EXISTS public.appointments CASCADE;
DROP TABLE IF EXISTS public.intent_line_items CASCADE;
DROP TABLE IF EXISTS public.booking_intents CASCADE;

DROP TYPE IF EXISTS payout_status;
DROP TYPE IF EXISTS transaction_status;
DROP TYPE IF EXISTS payment_method;
DROP TYPE IF EXISTS appointment_status;
DROP TYPE IF EXISTS intent_status;
