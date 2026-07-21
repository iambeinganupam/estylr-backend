-- ─────────────────────────────────────────────────────────────────────────────
-- 040 — Audit log: append-only trail of admin write actions
--
-- Every super-admin write path (vendor suspend, KYC approve, commission waive,
-- settings change, etc.) writes one row here via the `recordAudit()` helper
-- in `backend/src/lib/audit-log.ts`. The table is hard append-only at the DB
-- layer: a trigger blocks UPDATE and DELETE on every row regardless of role.
-- Compliance can demand the trail; we make it impossible to rewrite history.
--
-- `payload_before` / `payload_after` are JSONB diffs of the entity. They are
-- intentionally redundant with the row in the source table — the source row
-- mutates while audit_log is frozen, so the diff is the only way to answer
-- "what did this look like before the change?".
--
-- Indexes are tuned for the three queries the Activity Log page issues:
--   1. recent activity globally           (created_at DESC)
--   2. activity by an admin user          (admin_user_id, created_at DESC)
--   3. activity targeting a single entity (entity_type, entity_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   UUID NOT NULL REFERENCES public.users(id),
  action          VARCHAR(64)  NOT NULL,
  entity_type     VARCHAR(32)  NOT NULL,
  entity_id       UUID,
  payload_before  JSONB,
  payload_after   JSONB,
  reason          TEXT,
  ip_address      INET,
  user_agent      TEXT,
  request_id      VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_created_at ON public.audit_log (created_at DESC);
CREATE INDEX idx_audit_log_admin      ON public.audit_log (admin_user_id, created_at DESC);
CREATE INDEX idx_audit_log_entity     ON public.audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_action     ON public.audit_log (action, created_at DESC);

-- ── Hard append-only enforcement ─────────────────────────────────────────────
-- A trigger that raises on UPDATE / DELETE. Works regardless of the calling
-- role, so a leaked superuser credential still cannot rewrite the trail.
CREATE OR REPLACE FUNCTION public.audit_log_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only — % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_mutation();

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_mutation();

COMMENT ON TABLE  public.audit_log IS
  'Append-only trail of admin write actions. UPDATE/DELETE blocked by trigger.';
COMMENT ON COLUMN public.audit_log.action IS
  'Dot-namespaced verb. Examples: vendor.suspend, kyc.approve, commission.waive, refund.approve, settings.update.';
COMMENT ON COLUMN public.audit_log.entity_type IS
  'One of: vendor, customer, staff, booking, kyc, commission, refund, settings, category, plan, user.';
COMMENT ON COLUMN public.audit_log.payload_before IS
  'Snapshot of the entity prior to the change. NULL for create actions.';
COMMENT ON COLUMN public.audit_log.payload_after IS
  'Snapshot of the entity after the change. NULL for delete actions.';
