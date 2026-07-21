-- TYPE: schema
-- Down migration for 035_bank_accounts_primary_unique.up.sql
-- Removes: uniq_bank_accounts_vendor_primary partial unique index

DROP INDEX IF EXISTS uniq_bank_accounts_vendor_primary;
