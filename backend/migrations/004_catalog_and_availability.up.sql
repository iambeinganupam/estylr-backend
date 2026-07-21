-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 004_catalog_and_availability
-- Description: Services, categories, working hours, time blocks, shifts
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Service Categories ──
CREATE TABLE public.service_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES public.service_categories(id),
  name        VARCHAR(100) NOT NULL,
  icon_url    VARCHAR(500),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Services (Vendor Catalog) ──
CREATE TABLE public.services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_type      VARCHAR(20) NOT NULL,  -- 'freelancer' | 'salon_location'
  vendor_id        UUID NOT NULL,
  category_id      UUID REFERENCES public.service_categories(id),
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  category         VARCHAR(100),
  price            NUMERIC(10,2) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  gender_target    VARCHAR(10) NOT NULL DEFAULT 'unisex',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Staff Service Overrides (different price for specific staff) ──
CREATE TABLE public.staff_service_overrides (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id        UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  staff_member_id   UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  override_price    NUMERIC(10,2),
  override_duration INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, staff_member_id)
);

-- ── Working Hours ──
CREATE TABLE public.working_hours (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   VARCHAR(20) NOT NULL,  -- 'freelancer' | 'salon_location' | 'staff_member'
  target_id     UUID NOT NULL,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time     TIME,
  close_time    TIME,
  is_closed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_type, target_id, day_of_week)
);

-- ── Time Blocks (Leave / Unavailability) ──
CREATE TABLE public.time_blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type     VARCHAR(20) NOT NULL,
  target_id       UUID NOT NULL,
  start_datetime  TIMESTAMPTZ NOT NULL,
  end_datetime    TIMESTAMPTZ NOT NULL,
  reason          VARCHAR(255),
  created_by      UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_datetime > start_datetime)
);

-- ── Shift Schedules ──
CREATE TYPE shift_type AS ENUM ('regular', 'overtime', 'holiday', 'leave');

CREATE TABLE public.shift_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id   UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  shift_date        DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  type              shift_type NOT NULL DEFAULT 'regular',
  is_approved       BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by       UUID REFERENCES public.users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_services_vendor ON public.services(vendor_type, vendor_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_working_hours_target ON public.working_hours(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_time_blocks_target_range ON public.time_blocks(target_id, start_datetime, end_datetime);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_date ON public.shift_schedules(staff_member_id, shift_date);

CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON public.shift_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
