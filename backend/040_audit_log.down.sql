-- Reverses 040_audit_log.up.sql

DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON public.audit_log;
DROP TRIGGER IF EXISTS trg_audit_log_no_update ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_block_mutation();
DROP TABLE  IF EXISTS public.audit_log;
