-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 022_media_service_link
-- Description: Link portfolio media items to a specific service so the gallery
--              can be filtered by service category. Max 3 photos per service is
--              enforced in the service layer (allows clear error messages).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.media_items
  ADD COLUMN service_id UUID NULL REFERENCES public.services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_items_service
  ON public.media_items(service_id)
  WHERE service_id IS NOT NULL;
