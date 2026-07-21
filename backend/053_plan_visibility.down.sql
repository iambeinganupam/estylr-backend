-- TYPE: schema
ALTER TABLE public.subscription_plans
  DROP COLUMN IF EXISTS is_publicly_selectable;
