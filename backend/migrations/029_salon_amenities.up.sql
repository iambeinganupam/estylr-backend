-- Migration 029: salon location amenities (wifi / parking / AC / etc.)
--
-- Amenities are *physical-location* attributes (a chain may have AC at one
-- branch but not another) so they live on `salon_locations`, not
-- `business_accounts`. Stored as a TEXT[] of stable taxonomy keys (snake_case)
-- so the value space stays curated and customer-side filtering can use
-- `WHERE amenities && ARRAY['wifi','parking']` (Postgres array overlap).
--
-- The taxonomy itself is the single source of truth in
-- `packages/api-client/src/types/business.types.ts` (`SALON_AMENITIES`),
-- consumed by every dashboard + the public web portal. Promote to a
-- normalised `amenity_types` lookup table only once we need admin-managed
-- icons / translations / regional variants.
--
-- NOTE for future work: when the customer dashboard wires an amenity filter
-- in `/discover/search`, extend `mv_vendor_discovery` to project this column
-- (DROP + CREATE — single in-place ALTER is not supported on materialised
-- views). For now the search endpoint can JOIN `salon_locations` for the
-- `salon_location` half of the union if it needs to filter on amenities.
ALTER TABLE public.salon_locations
  ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT '{}';

-- GIN index supports the array-overlap operator used by customer search.
CREATE INDEX IF NOT EXISTS idx_salon_locations_amenities
  ON public.salon_locations USING GIN (amenities);
