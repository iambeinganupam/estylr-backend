// ─────────────────────────────────────────────────────────────────────────────
// Refund Dispatcher — Outbox Worker
// Polls for APPROVED refunds that have not yet been settled with the payment
// provider and executes the refund. Mirrors notification-dispatcher.job.ts:
// claim a batch with SELECT ... FOR UPDATE SKIP LOCKED inside a short
// transaction, then call the gateway outside the transaction. Errors are
// logged and recorded per-refund, never thrown out of the tick.
//
// Audit note: recordAudit() requires an Express `req` (admin_user_id, IP,
// user-agent). A background job has no request context and the notifications
// dispatcher likewise records no audit — so we deliberately omit it here
// rather than fabricate a fake req. The refund_requests row + dues ledger are
// the durable record; provider_ref is set on success.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '../config/env';
import { logger } from '../config/logger';
import { withTransaction } from '../config/database';
import { getPaymentGateway } from '../adapters';
import { paymentAttemptsTotal } from '../lib/metrics';
import {
  adminRefundsRepository,
  type RefundDispatchRow,
} from '../modules/admin-refunds/admin-refunds.repository';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function processOne(row: RefundDispatchRow): Promise<void> {
  // Defensive: claimRefundsForDispatch only returns refunds whose appointment
  // has a completed gateway transaction with a non-null external_ref, so this
  // should never fire. Cash/UPI refunds (no gateway ref) stay `approved` for an
  // admin to complete manually via PATCH /admin/refunds/:id/complete.
  if (!row.external_ref) {
    logger.error(
      { refundId: row.id, appointmentId: row.appointment_id },
      'refund-dispatcher: claimed row unexpectedly has no external_ref; skipping',
    );
    return;
  }

  try {
    // row.amount is NUMERIC(10,2) in rupees. row.gateway_amount_paise is the
    // DB-computed integer (ROUND(amount * 100)) — no manual *100 math in the app.
    // The payment adapter interface accepts rupees, so we pass row.amount directly.
    // Pass the refund id as the idempotency key so a crash before markCompleted
    // cannot double-refund on the next tick.
    const result = await getPaymentGateway().refundPayment(row.external_ref, row.amount, row.id);
    await adminRefundsRepository.markCompleted(row.id, result.refund_id);
    paymentAttemptsTotal.inc({ outcome: 'refunded', provider: env.PAYMENT_PROVIDER });
    logger.info(
      { refundId: row.id, providerRef: result.refund_id, status: result.status, amountRupees: row.amount, gatewayPaise: row.gateway_amount_paise },
      'refund-dispatcher: refund completed',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await adminRefundsRepository.recordDispatchAttempt(row.id, message);
    logger.warn({ err, refundId: row.id }, 'refund-dispatcher: provider refund failed');
  }
}

async function tick(): Promise<void> {
  if (running) return; // overlap guard — previous tick still working
  running = true;
  try {
    // Phase 1: claim a batch using SKIP LOCKED inside a short transaction that
    // commits immediately, releasing the row locks before the provider calls.
    let batch: RefundDispatchRow[] = [];
    await withTransaction(async (client) => {
      batch = await adminRefundsRepository.claimRefundsForDispatch(
        env.REFUND_DISPATCH_BATCH_SIZE,
        env.REFUND_MAX_ATTEMPTS,
        client,
      );
    });

    if (batch.length === 0) return;

    // Phase 2: process each row outside the transaction.
    logger.debug({ count: batch.length }, 'refund-dispatcher: processing batch');
    for (const row of batch) {
      try {
        await processOne(row);
      } catch (err) {
        // processOne owns its own per-refund error handling; this is defensive.
        logger.warn({ err, refundId: row.id }, 'refund-dispatcher: processOne threw');
      }
    }
  } catch (err) {
    logger.error({ err }, 'refund-dispatcher: tick error');
  } finally {
    running = false;
  }
}

export function startRefundDispatcher(): void {
  if (timer) return;
  const interval = env.REFUND_DISPATCH_INTERVAL_MS;
  logger.info(
    { intervalMs: interval, batchSize: env.REFUND_DISPATCH_BATCH_SIZE },
    'refund-dispatcher: starting',
  );
  // First tick after a short delay to let the rest of the server warm up.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => { void tick(); }, interval);
  }, 2000);
}

export function stopRefundDispatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// Exported for tests:
export const __forTests = { tick, processOne };
