-- Migration 070 down: no-op. Reverting these rows back to business_account_id
-- would re-introduce the data-integrity bug — the correct invariant is that
-- `vendor_id` for `vendor_type='salon_location'` references `salon_locations.id`.
SELECT 1;
