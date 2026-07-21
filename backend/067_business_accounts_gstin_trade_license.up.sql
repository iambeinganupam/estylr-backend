-- Migration 067: business_accounts.gstin + business_accounts.trade_license
-- These columns are referenced by auth.repository (createBusinessAdmin INSERT),
-- kyc.repository (listPending SELECT projection), finance.repository, and the
-- business module's update allow-list, but were never created in any prior
-- migration. tax_id_number remains as the generic tax identifier; gstin is the
-- India-specific GSTIN-format identifier the code already validates via the
-- Zod regex in business.schemas.ts. trade_license is a separate document
-- identifier surfaced to KYC reviewers.

ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS gstin         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS trade_license VARCHAR(100);
