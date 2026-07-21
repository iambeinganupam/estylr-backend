-- ─────────────────────────────────────────────────────────────────────────────
-- Down: 044_event_manager_extensions
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.event_bookings_extended
  DROP COLUMN IF EXISTS services,
  DROP COLUMN IF EXISTS client_email,
  DROP COLUMN IF EXISTS client_contact,
  DROP COLUMN IF EXISTS client_name;

DROP TABLE IF EXISTS public.event_communications      CASCADE;
DROP TABLE IF EXISTS public.event_manager_templates   CASCADE;
DROP TABLE IF EXISTS public.event_manager_portfolios  CASCADE;
DROP TABLE IF EXISTS public.event_transactions        CASCADE;
DROP TABLE IF EXISTS public.event_payments            CASCADE;
DROP TABLE IF EXISTS public.event_tasks               CASCADE;
DROP TABLE IF EXISTS public.event_budget_items        CASCADE;
DROP TABLE IF EXISTS public.event_managed_guests      CASCADE;
DROP TABLE IF EXISTS public.event_vendors             CASCADE;

DROP TYPE IF EXISTS event_message_direction;
DROP TYPE IF EXISTS event_tx_status;
DROP TYPE IF EXISTS event_tx_method;
DROP TYPE IF EXISTS event_tx_type;
DROP TYPE IF EXISTS event_payment_status;
DROP TYPE IF EXISTS event_task_status;
DROP TYPE IF EXISTS budget_item_status;
DROP TYPE IF EXISTS guest_side;
DROP TYPE IF EXISTS guest_category;
DROP TYPE IF EXISTS rsvp_status;
DROP TYPE IF EXISTS event_vendor_status;
