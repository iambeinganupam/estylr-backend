-- Migration 070: remap vendor_id from business_account_id → primary salon_location_id.
--
-- Historical bug in `resolveVendor()` (catalog/media/availability/booking/kyc
-- controllers): when `req.tenant.locationId` was undefined for a business_admin,
-- the code fell back to `req.tenant.businessId` (= business_accounts.id) and
-- persisted THAT as `vendor_id` in tables that polymorphically reference a
-- vendor surface via `(vendor_type, vendor_id)`.
--
-- The correct invariant is:
--   • vendor_type = 'salon_location'   → vendor_id ∈ salon_locations(id)
--   • vendor_type = 'freelancer'       → vendor_id ∈ freelancer_profiles(id)
--   • Never `business_accounts.id` — that's the legal parent, not a vendor
--     surface.
--
-- The application-level fix lives in `tenant.middleware.ts`: business_admin
-- requests without an `X-Location-Id` header now auto-resolve the primary
-- (oldest active) salon_locations row, so downstream code always gets a
-- real location id. This migration cleans up the rows that the bug left
-- behind so the customer-portal discovery queries (which correctly key on
-- salon_locations.id) start seeing the data.
--
-- Idempotent: only touches rows where `vendor_id` matches a
-- business_accounts.id. Rows already keyed correctly are untouched.

BEGIN;

-- For each affected business_account, pick its primary (oldest active) location.
-- A CTE keeps the lookup consistent across every UPDATE below.
CREATE TEMP TABLE primary_location AS
  SELECT DISTINCT ON (sl.business_account_id)
         sl.business_account_id AS business_id,
         sl.id                   AS location_id
    FROM public.salon_locations sl
   WHERE sl.is_active = TRUE
   ORDER BY sl.business_account_id, sl.created_at;

-- Helper macro (manual): for each polymorphic table, replace vendor_id with
-- the matching primary location id where the current vendor_id is a known
-- business_account.

UPDATE public.services s
   SET vendor_id = pl.location_id
  FROM primary_location pl
 WHERE s.vendor_type = 'salon_location'
   AND s.vendor_id = pl.business_id;

UPDATE public.media_items m
   SET vendor_id = pl.location_id
  FROM primary_location pl
 WHERE m.vendor_type = 'salon_location'
   AND m.vendor_id = pl.business_id;

UPDATE public.vendor_products vp
   SET vendor_id = pl.location_id
  FROM primary_location pl
 WHERE vp.vendor_type = 'salon_location'
   AND vp.vendor_id = pl.business_id;

UPDATE public.appointments a
   SET vendor_id = pl.location_id
  FROM primary_location pl
 WHERE a.vendor_type = 'salon_location'
   AND a.vendor_id = pl.business_id;

UPDATE public.kyc_submissions k
   SET vendor_id = pl.location_id
  FROM primary_location pl
 WHERE k.vendor_type = 'salon_location'
   AND k.vendor_id = pl.business_id;

-- Other vendor_id tables audited at 2026-05-22 had zero affected rows:
--   booking_intents, favorites, message_threads, refund_requests, reviews,
--   service_categories, vendor_dues_ledger, vendor_entitlement_overrides,
--   vendor_outstanding_balance. Re-run the audit below if reintroducing the
--   bug is suspected after a deploy.

DROP TABLE IF EXISTS primary_location;

COMMIT;
