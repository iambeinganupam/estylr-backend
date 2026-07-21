-- TYPE: schema
-- ─────────────────────────────────────────────────────────────────────────────
-- 052 — Customer ↔ vendor messaging
--   * message_threads: one per (customer, vendor, optional appointment)
--   * messages: append-only, monotonic per-thread seq for cursor polling
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.message_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vendor_type       vendor_type NOT NULL,
  vendor_id         UUID NOT NULL,
  vendor_user_id    UUID NOT NULL REFERENCES public.users(id),
  appointment_id    UUID REFERENCES public.appointments(id),
  last_message_at   TIMESTAMPTZ,
  last_message_seq  BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, vendor_type, vendor_id, appointment_id)
);

CREATE INDEX idx_threads_customer ON public.message_threads(customer_id, last_message_at DESC);
CREATE INDEX idx_threads_vendor   ON public.message_threads(vendor_user_id, last_message_at DESC);

CREATE TABLE public.messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES public.users(id),
  seq         BIGINT NOT NULL,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  media_id    UUID REFERENCES public.media_items(id),
  read_by_recipient_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (thread_id, seq)
);

CREATE INDEX idx_messages_thread_seq ON public.messages(thread_id, seq);
CREATE INDEX idx_messages_unread     ON public.messages(thread_id) WHERE read_by_recipient_at IS NULL;

COMMENT ON TABLE public.message_threads IS
  'One thread per (customer, vendor, appointment?) — UNIQUE constraint enforces this. last_message_seq used for cursor polling.';
