-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 061 — Align `shift_type` enum to the client-facing vocabulary
--
-- Background
--   Migration 004 created `shift_type` as an HR-leaning enum:
--     ('regular', 'overtime', 'holiday', 'leave')
--   Every dashboard, the shared @kshuri/api-client, and src/lib/constants.ts
--   speak the calendar-app vocabulary:
--     ('regular_shift', 'time_off', 'lunch_break')
--   The two never agreed, which forced a translation mapper in the service
--   layer and meant `time_off`-conditional UI never rendered (the value
--   never came back from the DB).
--
-- What this does
--   Re-creates the enum with the client vocabulary as the canonical set,
--   migrating existing rows via a lossy CASE map (overtime/holiday/leave
--   collapse to the nearest client equivalent). The old type is dropped
--   and the new one renamed back to `shift_type` so the column / constants
--   continue to reference the same identifier.
--
-- Why this is safe
--   `shift_schedules.type` is the only column referencing `shift_type`.
--   No view, function, or other table depends on the type.
--   `lunch_break` is a brand-new value and has no source row to migrate.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shift_schedules ALTER COLUMN type DROP DEFAULT;

CREATE TYPE shift_type_new AS ENUM ('regular_shift', 'time_off', 'lunch_break');

ALTER TABLE public.shift_schedules
  ALTER COLUMN type TYPE shift_type_new USING (
    CASE type::text
      WHEN 'regular'  THEN 'regular_shift'::shift_type_new
      WHEN 'overtime' THEN 'regular_shift'::shift_type_new
      WHEN 'holiday'  THEN 'time_off'::shift_type_new
      WHEN 'leave'    THEN 'time_off'::shift_type_new
      ELSE 'regular_shift'::shift_type_new
    END
  );

DROP TYPE shift_type;
ALTER TYPE shift_type_new RENAME TO shift_type;

ALTER TABLE public.shift_schedules ALTER COLUMN type SET DEFAULT 'regular_shift';
