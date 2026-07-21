-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 015_products
-- Description: Create vendor_products table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vendor_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_type VARCHAR(50) NOT NULL CHECK (vendor_type IN ('freelancer', 'salon_location')),
    vendor_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    price DECIMAL(10,2) NOT NULL,
    stock INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON public.vendor_products(vendor_type, vendor_id);

ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_read ON public.vendor_products
    FOR SELECT USING (is_active = TRUE);

CREATE POLICY products_write ON public.vendor_products
    FOR ALL USING (
        (vendor_type = 'salon_location' AND vendor_id IN (
            SELECT id FROM public.salon_locations WHERE business_account_id IN (
                SELECT id FROM public.business_accounts WHERE owner_user_id = auth.uid()
            )
        )) OR
        (vendor_type = 'freelancer' AND vendor_id IN (
            SELECT id FROM public.freelancer_profiles WHERE user_id = auth.uid()
        ))
    );
