-- TYPE: schema
-- Down migration for 001_enable_extensions.up.sql
-- Removes: (none — extensions are not dropped on down due to system-wide effect)

-- Extensions are intentionally not dropped here because they may be used by other
-- databases on the same PostgreSQL server. Dropping them could break other tenants.
-- uuid-ossp, pgcrypto, postgis, pg_trgm, unaccent are left in place.
SELECT 1; -- no-op to keep the runner happy
