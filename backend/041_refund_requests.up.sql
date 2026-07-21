-- ─────────────────────────────────────────────────────────────────────────────
-- 041 — Refund requests: customer-initiated refund flow with admin approval
--
-- A refund moves through four states:
--
--   pending   — customer submitted, waiting on admin
--   approved  — admin approved; refund job is queued (provider call lives in
--               the job, not in this transaction; cleaner retry semantics)
--   rejected  — admin rejected with a note
--   completed — provider acknowledged the refund and the money is back
--
-- `amount_inr` is in **paise** (consistent with `transactions.amount` and the
-- finance module's int-paise convention). `vendor_type` + `vendor_id` are
-- denormalised onto the request so the cross-tenant admin list filters
-- without a join — the appointment row may be archived later.
--
-- A partial unique index keeps a single open (pending / approved-but-not-
-- completed) request per appointment; rejected ones don't block re-filing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE refund_status AS ENUM ('pending', 'approved', 'rejected', 'completed');

CREATE TABLE public.refund_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES public.users(id),
  vendor_type     vendor_type NOT NULL,
  vendor_id       UUID NOT NULL,
  amount_inr      INTEGER NOT NULL CHECK (amount_inr > 0),         -- paise
  reason          TEXT NOT NULL,
  status          refund_status NOT NULL DEFAULT 'pending',
  resolved_by     UUID REFERENCES public.users(id),
  resolved_note   TEXT,
  resolved_at     TIMESTAMPTZ,
  provider_ref    VARCHAR(255),                                    -- gateway refund ID once completed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT refund_requests_resolution_consistent
    CHECK (
      (status IN ('pending') AND resolved_by IS NULL AND resolved_at IS NULL)
      OR
      (status IN ('approved', 'rejected', 'completed') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX idx_refunds_status_created
  ON public.refund_requests (status, created_at DESC);

CREATE INDEX idx_refunds_vendor
  ON public.refund_requests (vendor_type, vendor_id, created_at DESC);

CREATE INDEX idx_refunds_customer
  ON public.refund_requests (customer_id, created_at DESC);

-- Only one active (non-final) refund per appointment.
CREATE UNIQUE INDEX uniq_refunds_one_open_per_appointment
  ON public.refund_requests (appointment_id)
  WHERE status IN ('pending', 'approved');

CREATE TRIGGER trg_refund_requests_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE  public.refund_requests IS
  'Customer-initiated refund flow. Admin approves/rejects; provider settlement lives in a downstream job.';
COMMENT ON COLUMN public.refund_requests.amount_inr IS
  'Refund amount in paise (1 INR = 100 paise). Matches transactions.amount convention.';
COMMENT ON COLUMN public.refund_requests.provider_ref IS
  'Payment provider refund reference, populated when status transitions to completed.';
