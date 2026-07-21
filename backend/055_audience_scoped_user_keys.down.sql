-- TYPE: schema
-- Roll back the composite-uniqueness change. Restoring the global UNIQUE
-- constraints can only succeed when no duplicates exist across roles, so
-- this rollback errors loudly if the new model has already accumulated
-- legitimate cross-role registrations.

DROP INDEX IF EXISTS public.users_phone_role_unique;
DROP INDEX IF EXISTS public.users_email_role_unique;

ALTER TABLE public.users ADD CONSTRAINT users_phone_number_key UNIQUE (phone_number);
ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);
