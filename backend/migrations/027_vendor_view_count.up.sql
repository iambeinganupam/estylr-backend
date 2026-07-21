-- Migration 027: vendor profile view counter
-- Denormalized counter on salon_locations + freelancer_profiles. Customer-facing
-- apps (kshuri-customer-dashboard, kshuri-portal) call POST
-- /discovery/vendors/:type/:id/view when rendering a vendor profile, which
-- increments this counter. Salon dashboards read it via
-- GET /business/profile/engagement.
--
-- v1 keeps it as a single counter — no per-event log, no dedup. Good enough for
-- a "Profile Views" tile. Promote to an event log + materialised daily counter
-- once we need a chart or per-day series.
ALTER TABLE public.salon_locations
  ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.freelancer_profiles
  ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;
