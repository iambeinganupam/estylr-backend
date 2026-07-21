-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 061 DOWN — Restore the legacy HR vocabulary for `shift_type`.
-- The mapping back is lossy: `lunch_break` collapses to `leave` because the
-- legacy enum has no equivalent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shift_schedules ALTER COLUMN type DROP DEFAULT;

CREATE TYPE shift_type_old AS ENUM ('regular', 'overtime', 'holiday', 'leave');

ALTER TABLE public.shift_schedules
  ALTER COLUMN type TYPE shift_type_old USING (
    CASE type::text
      WHEN 'regular_shift' THEN 'regular'::shift_type_old
      WHEN 'time_off'      THEN 'leave'::shift_type_old
      WHEN 'lunch_break'   THEN 'leave'::shift_type_old
      ELSE 'regular'::shift_type_old
    END
  );

DROP TYPE shift_type;
ALTER TYPE shift_type_old RENAME TO shift_type;

ALTER TABLE public.shift_schedules ALTER COLUMN type SET DEFAULT 'regular';
