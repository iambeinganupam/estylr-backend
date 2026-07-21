// ─────────────────────────────────────────────────────────────────────────────
// Payments Module — Service
// ─────────────────────────────────────────────────────────────────────────────
// Business logic. Wires paymentAttemptsTotal counter at every outcome.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { paymentsRepository, type TransactionRow } from './payments.repository';
import { paymentAttemptsTotal } from '../../lib/metrics';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { ResourceNotFoundError, ConflictError } from '../../lib/errors';
import { withTransaction } from '../../config/database';
import { resolveTransition, APPOINTMENT_TRANSITIONS } from '../../lib/state-machine';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import type { NormalizedWebhookEvent } from '../../adapters/payment/payment.provider';
import type { RecordPaymentAttemptInput, ListTransactionsQuery } from './payments.schemas';

export const paymentsService = {
  /**
   * Called by the webhook controller after HMAC signature verification.
   * Persists the transaction row and increments the Prometheus counter.
   */
  async recordWebhookAttempt(
    input: RecordPaymentAttemptInput,
  ): Promise<TransactionRow> {
    const tx = await paymentsRepository.recordAttempt(input);

    // ── paymentAttemptsTotal call site #1 — settled ──────────────────────────
    // ── paymentAttemptsTotal call site #2 — failed  ──────────────────────────
    // ── paymentAttemptsTotal call site #3 — pending (pass-through) ───────────
    const outcome = input.status === 'settled'
      ? 'settled'
      : input.status === 'failed'
        ? 'failed'
        : 'pending';

    paymentAttemptsTotal.inc({ outcome, provider: input.provider });

    return tx;
  },

  /**
   * Reconcile a verified, normalized gateway webhook event against the
   * `transactions` row finance.service created at booking time (matched by
   * external_ref = gateway order id). Idempotent: replays and unknown refs
   * are safe no-ops. The transaction-row update and appointment confirmation
   * commit atomically so a captured payment can never leave a paid booking
   * unconfirmed (or vice-versa).
   */
  async reconcilePaymentEvent(event: NormalizedWebhookEvent): Promise<void> {
    const provider = env.PAYMENT_PROVIDER;

    await withTransaction(async (client) => {
      // Lock the transaction row to serialize concurrent webhook deliveries.
      const txRes = await client.query<TransactionRow>(
        'SELECT * FROM public.transactions WHERE external_ref = $1 FOR UPDATE',
        [event.gatewayRef],
      );
      const tx = txRes.rows[0];
      if (!tx) {
        logger.info({ gatewayRef: event.gatewayRef, kind: event.kind }, 'payment webhook: no transaction for external_ref — acking');
        return;
      }
      // The DB transaction_status enum (pending|completed|failed|refunded) is
      // wider than the coarse TxStatus constant, so read the raw string.
      const currentTxStatus = String(tx.status);

      if (event.kind === 'payment_succeeded') {
        // Only a still-pending transaction transitions to completed. Already
        // completed (replay) AND already failed (Razorpay can deliver
        // payment.failed then payment.captured out of order) both no-op.
        if (currentTxStatus !== 'pending') return; // idempotent

        await client.query(
          `UPDATE public.transactions SET status = 'completed'::transaction_status, updated_at = now() WHERE id = $1`,
          [tx.id],
        );

        if (tx.appointment_id) {
          // Confirm the appointment through the canonical state machine.
          // Already-confirmed (or later) appointments are an idempotent no-op.
          const aptRes = await client.query<{ status: string }>(
            'SELECT status FROM public.appointments WHERE id = $1 FOR UPDATE',
            [tx.appointment_id],
          );
          const current = aptRes.rows[0]?.status;
          if (current === 'pending') {
            // 'system' is not in allowedRoles, but resolveTransition only
            // enforces roles when actorRole is provided — omit it for the
            // gateway-driven path so the confirm is always permitted.
            const next = resolveTransition(current, 'confirm', APPOINTMENT_TRANSITIONS);
            await client.query(
              `UPDATE public.appointments SET status = $2::appointment_status, updated_at = now() WHERE id = $1`,
              [tx.appointment_id, next],
            );
          }
        }

        paymentAttemptsTotal.inc({ outcome: 'settled', provider });
      } else {
        // payment_failed — only a still-pending transaction transitions to failed.
        if (currentTxStatus !== 'pending') return; // idempotent

        await client.query(
          `UPDATE public.transactions SET status = 'failed'::transaction_status, updated_at = now() WHERE id = $1`,
          [tx.id],
        );
        paymentAttemptsTotal.inc({ outcome: 'failed', provider });
      }
    });
  },

  /**
   * Admin-initiated refund. Records audit log and increments counter.
   */
  async processRefund(
    txId: string,
    reason: string,
    req: Request,
  ): Promise<TransactionRow> {
    const candidate = await paymentsRepository.findRefundCandidate(txId);
    if (!candidate) {
      // Either not found, not yet settled, or already refunded.
      const existing = await paymentsRepository.findById(txId);
      if (!existing) throw new ResourceNotFoundError('Transaction not found');
      throw new ConflictError('Transaction is not eligible for refund (not settled, or already refunded)');
    }

    const refundAmount = parseFloat(candidate.amount);
    const updated = await paymentsRepository.applyRefund(txId, refundAmount, reason);

    // Best-effort audit log (swallows errors internally).
    await recordAudit({
      action: AUDIT_ACTION.TRANSACTION_REFUND,
      entityType: AUDIT_ENTITY.TRANSACTION,
      entityId: txId,
      before: { status: candidate.status },
      after:  { status: 'refunded', refund_reason: reason },
      reason,
      req,
    });

    // ── paymentAttemptsTotal call site #4 — refunded ─────────────────────────
    const provider = env.PAYMENT_PROVIDER;
    paymentAttemptsTotal.inc({ outcome: 'refunded', provider });

    return updated!;
  },

  /**
   * Vendor-facing paginated list of their own transactions.
   */
  async listVendorTransactions(
    vendorId: string,
    query: ListTransactionsQuery,
  ): Promise<{ rows: TransactionRow[]; total: number }> {
    return paymentsRepository.listForVendor(vendorId, query);
  },
};
