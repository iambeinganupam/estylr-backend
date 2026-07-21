-- TYPE: schema
-- Down migration for 024_transaction_tax_breakdown.up.sql
-- Removes: subtotal, tax_amount, tax_rate, bill_number columns,
--          idx_transactions_bill_number unique index, and invoice_seq sequence
--          from transactions table

DROP INDEX IF EXISTS idx_transactions_bill_number;

ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS bill_number,
  DROP COLUMN IF EXISTS tax_rate,
  DROP COLUMN IF EXISTS tax_amount,
  DROP COLUMN IF EXISTS subtotal;

DROP SEQUENCE IF EXISTS public.invoice_seq;
