-- Migration 069 down: no-op — backfilled slugs are user-visible URLs,
-- reverting them to NULL would break any externally-shared links. If a
-- specific slug needs to be reset, do it surgically via an admin tool.
SELECT 1;
