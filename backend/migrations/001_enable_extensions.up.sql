-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 001_enable_extensions
-- Description: Enable required PostgreSQL extensions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search on names

-- Trigram index support for fast ILIKE queries
CREATE EXTENSION IF NOT EXISTS "unaccent"; -- For locale-insensitive search (Bangalore vs Bengaluru)
