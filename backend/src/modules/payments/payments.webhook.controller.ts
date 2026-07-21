// ─────────────────────────────────────────────────────────────────────────────
// Payments Webhook Controller (provider-aware)
// ─────────────────────────────────────────────────────────────────────────────
// Signature verification + parsing are delegated to the configured
// PaymentGateway (mock | razorpay | …) so this route stays provider-agnostic:
//   • read the signature from the gateway's own header
//   • verify the EXACT raw bytes against PAYMENT_WEBHOOK_SECRET
//   • parse into a NormalizedWebhookEvent and reconcile the booking
// Gateways that don't map a payload (mock, or unhandled events) fall back to
// the legacy best-effort recordAttempt path. Valid signatures always 200.
// ─────────────────────────────────────────────────────────────────────────────

import express, { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { success } from '../../lib/response';
import { env } from '../../config/env';
import { TokenInvalidError } from '../../lib/errors';
import { logger } from '../../config/logger';
import { getPaymentGateway } from '../../adapters';
import { paymentsService } from './payments.service';
import { recordPaymentAttemptSchema } from './payments.schemas';

export const paymentsWebhookController = Router();

// CRITICAL: raw body parser — HMAC verifies the EXACT bytes the gateway sent.
// JSON.parse-then-stringify would corrupt the signature.
paymentsWebhookController.post(
  '/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const gateway = getPaymentGateway();
    const signature = req.header(gateway.webhookSignatureHeader) ?? '';
    const secret = env.PAYMENT_WEBHOOK_SECRET;

    if (!secret) {
      logger.warn('Payment webhook called but PAYMENT_WEBHOOK_SECRET is unset; rejecting');
      throw new TokenInvalidError();
    }
    if (!signature) {
      throw new TokenInvalidError();
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const rawBodyString = rawBody.toString('utf8');

    if (!gateway.verifyWebhookSignature(rawBodyString, signature)) {
      throw new TokenInvalidError();
    }

    logger.info({ bytes: rawBody.length }, 'payment webhook accepted');

    // Provider-aware parse → reconcile. Best-effort: a reconciliation error
    // must not break the 200 ack (the gateway would otherwise retry forever).
    const event = gateway.parseWebhookEvent(rawBodyString);
    if (event) {
      try {
        await paymentsService.reconcilePaymentEvent(event);
      } catch (err: unknown) {
        logger.error({ err, gatewayRef: event.gatewayRef, kind: event.kind }, 'payment webhook: reconciliation failed');
      }
      success(res, { received: true });
      return;
    }

    // Unmapped payload (mock gateway, or an event we don't reconcile) —
    // preserve the legacy best-effort recordAttempt path.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBodyString) as Record<string, unknown>;
    } catch {
      // Body is not JSON (e.g. form-encoded provider). Acknowledge without recording.
      success(res, { received: true });
      return;
    }

    const result = recordPaymentAttemptSchema.safeParse(parsed);
    if (result.success) {
      // Best-effort: record attempt; don't let a DB error break the 200 ack.
      paymentsService.recordWebhookAttempt(result.data).catch((err: unknown) => {
        logger.error({ err }, 'payment webhook: failed to record attempt');
      });
    } else {
      logger.warn({ issues: result.error.issues }, 'payment webhook: payload skipped (schema mismatch)');
    }

    success(res, { received: true });
  }),
);
