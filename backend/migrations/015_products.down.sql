-- TYPE: schema
-- Down migration for 015_products.up.sql
-- Removes: vendor_products table, its RLS policies, and index

DROP POLICY IF EXISTS products_write ON public.vendor_products;
DROP POLICY IF EXISTS products_read ON public.vendor_products;

DROP INDEX IF EXISTS idx_vendor_products_vendor;

DROP TABLE IF EXISTS public.vendor_products CASCADE;
