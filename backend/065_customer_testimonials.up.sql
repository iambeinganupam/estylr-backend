-- Migration 065: customer_testimonials
-- Backs the public GET /cms/testimonials endpoint.
-- service_category_id is nullable so testimonials can be either
-- category-tagged or general.

CREATE TABLE IF NOT EXISTS public.customer_testimonials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name       VARCHAR(120) NOT NULL,
  customer_city       VARCHAR(120) NOT NULL,
  quote               TEXT NOT NULL,
  rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  service_category_id UUID REFERENCES public.service_categories(id) ON DELETE SET NULL,
  photo_url           TEXT,
  is_published        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_testimonials_published_order
  ON public.customer_testimonials (sort_order ASC, created_at DESC)
 WHERE is_published = TRUE;

CREATE TRIGGER trg_customer_testimonials_updated_at
  BEFORE UPDATE ON public.customer_testimonials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
