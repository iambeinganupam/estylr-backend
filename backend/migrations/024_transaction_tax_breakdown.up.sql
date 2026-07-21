-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 024_transaction_tax_breakdown
-- Description:
--   Adds GST breakdown + bill numbering to transactions so each settled
--   transaction can be rendered as a customer-facing invoice.
--
--   Pricing model: service prices are tax-inclusive (the customer pays the
--   displayed total). The bill back-calculates the pre-tax subtotal and the
--   tax component from `amount` at bill-generation time and freezes them on
--   the transaction row — historical bills must NEVER change if the tax rate
--   later moves (GST audit requirement).
--
--   `bill_number` uses a global sequence rendered as `INV-NNNNNNNN`. Cleaner
--   than per-vendor sequences for MVP; can be partitioned later if needed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1000;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS subtotal     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tax_amount   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tax_rate     NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS bill_number  VARCHAR(32);

-- Backfill existing settled transactions assuming the default 18% GST (India,
-- salon services) and tax-inclusive pricing. New transactions will populate
-- these columns at insert time.
UPDATE public.transactions
SET tax_rate   = 18.00,
    subtotal   = ROUND(amount / 1.18, 2),
    tax_amount = amount - ROUND(amount / 1.18, 2)
WHERE subtotal IS NULL;

-- Bill numbers for existing rows (monotonic per their creation order).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM public.transactions
  WHERE bill_number IS NULL
)
UPDATE public.transactions t
SET bill_number = 'INV-' || lpad(n.rn::text, 8, '0')
FROM numbered n
WHERE t.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_bill_number
  ON public.transactions(bill_number)
  WHERE bill_number IS NOT NULL;
