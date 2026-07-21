-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 054 — Add 'kyc' to media_type enum
--
-- KYC documents share the same upload endpoint as portfolio media for now
-- (multipart upload → Cloudinary → media_items row), but they MUST NOT leak
-- into the public-facing gallery on the vendor's portfolio page. We added
-- the enum value so the backend can tag the row distinctly + the gallery
-- listing query can exclude it.
--
-- Postgres requires enum ALTER outside a transaction block, hence the
-- explicit COMMIT/BEGIN dance below — the migration runner wraps every
-- file in a transaction by default.
-- ─────────────────────────────────────────────────────────────────────────────

COMMIT;
ALTER TYPE public.media_type ADD VALUE IF NOT EXISTS 'kyc';
BEGIN;
