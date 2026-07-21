-- TYPE: schema
DROP TABLE IF EXISTS public.vendor_entitlement_overrides;
DROP TABLE IF EXISTS public.plan_entitlements;
DROP TABLE IF EXISTS public.feature_definitions;
ALTER TABLE public.business_accounts    DROP COLUMN IF EXISTS current_plan_code;
ALTER TABLE public.freelancer_profiles  DROP COLUMN IF EXISTS current_plan_code;
DROP TABLE IF EXISTS public.kyc_submissions;
DROP TYPE  IF EXISTS kyc_document_type;
