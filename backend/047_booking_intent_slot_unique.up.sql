-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 047_booking_intent_slot_unique — partial unique index that prevents two
-- locked intents from existing simultaneously on the same (vendor, slot).
-- Combined with the application-layer transaction in createIntent, this
-- eliminates the double-booking race documented in the spec audit §4.7.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_intents_active_slot
  ON public.booking_intents (vendor_id, scheduled_start)
  WHERE status = 'locked';

COMMENT ON INDEX public.uq_booking_intents_active_slot IS
  'Defense-in-depth: prevents two locked intents on the same slot. The application layer ALSO uses withTransaction + the same constraint surface.';
