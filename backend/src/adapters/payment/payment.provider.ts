// ─────────────────────────────────────────────────────────────────────────────
// Payment Gateway — Strategy Pattern Interface
// ─────────────────────────────────────────────────────────────────────────────
// Plug-and-play: switch gateways via PAYMENT_PROVIDER env var.
// Start: mock (dev) → Production: razorpay
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto';
import { withTimeout } from '../../lib/with-adapter-timeout';
import { ExternalServiceError } from '../../lib/errors';
import { env } from '../../config/env';

/** Constant-time HMAC-SHA256 hex comparison shared by the gateways. */
function verifyHmacSha256(payload: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  let provided: Buffer;
  let computed: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
    computed = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }
  return provided.length === computed.length && timingSafeEqual(provided, computed);
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'requires_payment' | 'succeeded' | 'failed' | 'cancelled';
  gateway_ref: string;
}

/**
 * Provider-agnostic webhook event the controller can reconcile against the
 * `transactions` table. `gatewayRef` is the value that matches
 * `transactions.external_ref` (the order id finance.service persisted).
 */
export interface NormalizedWebhookEvent {
  kind: 'payment_succeeded' | 'payment_failed';
  gatewayRef: string;
}

export interface PaymentGateway {
  /**
   * Create a payment intent for a booking.
   */
  createPaymentIntent(params: {
    amount: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent>;

  /**
   * Capture/confirm a payment.
   */
  capturePayment(paymentIntentId: string): Promise<PaymentIntent>;

  /**
   * Refund a payment (full or partial). `idempotencyKey`, when supplied, makes
   * provider retries safe — the gateway returns the same refund for the same
   * key, so a crash between the provider call and our local commit cannot
   * double-refund on the next dispatch tick.
   */
  refundPayment(paymentIntentId: string, amount?: number, idempotencyKey?: string): Promise<{
    refund_id: string;
    status: string;
  }>;

  /**
   * Header carrying the webhook signature for this provider (lower-case).
   * Razorpay: 'x-razorpay-signature'. Mock: 'x-webhook-signature'.
   */
  readonly webhookSignatureHeader: string;

  /**
   * Verify a webhook signature from the payment gateway.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean;

  /**
   * Parse a raw webhook body into a normalized, reconcilable event.
   * Returns null for events this gateway does not map (caller acks anyway).
   * Must be defensive — malformed/partial payloads return null, never throw.
   */
  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent | null;
}

/**
 * Mock Payment Gateway — intent/capture/refund auto-succeed (development only).
 * Webhook signature verification is NOT mocked: `verifyWebhookSignature` does a
 * real HMAC-SHA256 check against `PAYMENT_WEBHOOK_SECRET`, so the dev/test
 * webhook path still requires that secret to be set.
 */
export class MockPaymentGateway implements PaymentGateway {
  readonly webhookSignatureHeader = 'x-webhook-signature';

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    const id = `mock_pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      amount: params.amount,
      currency: params.currency,
      status: 'requires_payment',
      gateway_ref: id,
    };
  }

  async capturePayment(paymentIntentId: string): Promise<PaymentIntent> {
    return {
      id: paymentIntentId,
      amount: 0,
      currency: 'INR',
      status: 'succeeded',
      gateway_ref: paymentIntentId,
    };
  }

  async refundPayment(paymentIntentId: string, _amount?: number, _idempotencyKey?: string): Promise<{
    refund_id: string;
    status: string;
  }> {
    return {
      refund_id: `mock_refund_${paymentIntentId}`,
      status: 'succeeded',
    };
  }

  // Verify against PAYMENT_WEBHOOK_SECRET so the dev/test webhook path still
  // enforces a real HMAC gate (the controller delegates verification here).
  verifyWebhookSignature(payload: string, signature: string): boolean {
    return verifyHmacSha256(payload, signature, env.PAYMENT_WEBHOOK_SECRET ?? '');
  }

  // Mock maps nothing — webhooks fall through to the legacy recordAttempt path.
  parseWebhookEvent(_rawBody: string): NormalizedWebhookEvent | null {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay Payment Gateway — production (PAYMENT_PROVIDER=razorpay)
// ─────────────────────────────────────────────────────────────────────────────
// REST-over-fetch (no SDK bloat). Auth is HTTP Basic key_id:key_secret.
// All network calls are bounded by withTimeout(). The app stores amounts in
// rupees (NUMERIC(10,2)) and reads transactions.gateway_amount_paise for
// provider API calls. The conversion to/from paise happens here at the
// gateway adapter boundary — nowhere else in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

/** Razorpay order/payment lifecycle → our coarse PaymentIntent status. */
function mapRazorpayStatus(status: string): PaymentIntent['status'] {
  switch (status) {
    case 'captured':
    case 'paid':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'created':
    case 'authorized':
    case 'attempted':
    default:
      return 'requires_payment';
  }
}

const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
const paiseToRupees = (paise: number): number => paise / 100;

export class RazorpayPaymentGateway implements PaymentGateway {
  readonly webhookSignatureHeader = 'x-razorpay-signature';

  private authHeader: string;

  constructor(
    keyId: string,
    keySecret: string,
    private webhookSecret?: string,
  ) {
    this.authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    return withTimeout('payment/razorpay', async (signal) => {
      const res = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
        method,
        signal,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) {
        // Razorpay returns { error: { code, description } } on failure.
        let description = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text) as { error?: { description?: string } };
          if (parsed.error?.description) description = parsed.error.description;
        } catch {
          /* non-JSON error body — keep the status string */
        }
        throw new ExternalServiceError({ service: 'razorpay', message: `${method} ${path}: ${description}`, status: res.status });
      }
      return JSON.parse(text) as T;
    });
  }

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntent> {
    type Order = { id: string; amount: number; currency: string; status: string };
    const order = await this.request<Order>('POST', '/orders', {
      amount: rupeesToPaise(params.amount),
      currency: params.currency,
      payment_capture: 1, // auto-capture on successful payment
      notes: params.metadata ?? {},
    });
    return {
      id: order.id,
      amount: paiseToRupees(order.amount),
      currency: order.currency,
      status: mapRazorpayStatus(order.status),
      gateway_ref: order.id,
    };
  }

  async capturePayment(paymentIntentId: string): Promise<PaymentIntent> {
    type Payment = { id: string; amount: number; currency: string; status: string };
    // Resolve the payment first; with auto-capture it is usually already
    // 'captured'. If it is merely 'authorized' (manual-capture orders), capture it.
    const payment = await this.request<Payment>('GET', `/payments/${paymentIntentId}`);
    const captured = payment.status === 'authorized'
      ? await this.request<Payment>('POST', `/payments/${paymentIntentId}/capture`, {
          amount: payment.amount,
          currency: payment.currency,
        })
      : payment;
    return {
      id: captured.id,
      amount: paiseToRupees(captured.amount),
      currency: captured.currency,
      status: mapRazorpayStatus(captured.status),
      gateway_ref: captured.id,
    };
  }

  async refundPayment(paymentIntentId: string, amount?: number, idempotencyKey?: string): Promise<{ refund_id: string; status: string }> {
    type Refund = { id: string; status: string };
    // X-Razorpay-Idempotency-Key makes retries safe: Razorpay returns the same
    // refund object for a repeated key within 24h, so a crash between this call
    // and our local commit cannot double-refund on the next dispatch tick.
    const refund = await this.request<Refund>(
      'POST',
      `/payments/${paymentIntentId}/refund`,
      { ...(amount !== undefined ? { amount: rupeesToPaise(amount) } : {}) },
      idempotencyKey ? { 'X-Razorpay-Idempotency-Key': idempotencyKey } : undefined,
    );
    return { refund_id: refund.id, status: refund.status };
  }

  /**
   * Verify a Razorpay webhook signature — HMAC-SHA256 of the EXACT raw body
   * using the dashboard-configured webhook secret. Returns false (never throws)
   * so the caller decides the HTTP response.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    return verifyHmacSha256(payload, signature, this.webhookSecret ?? '');
  }

  /**
   * Map a Razorpay webhook payload to a normalized event. We only reconcile
   * payment lifecycle events; `gatewayRef` is the payment entity's `order_id`,
   * which finance.service stored as `transactions.external_ref`. Other events
   * (order.paid, refund.processed, …) and malformed bodies return null.
   */
  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const event = (parsed as { event?: unknown }).event;
    const kind =
      event === 'payment.captured'
        ? 'payment_succeeded'
        : event === 'payment.failed'
          ? 'payment_failed'
          : null;
    // `refund.processed` (and other events) intentionally return null:
    // refund reconciliation is deferred. transactions.status='refunded' is now
    // kept coherent synchronously by the refund dispatcher (it stamps the
    // transaction when marking the refund completed), so the refund webhook is
    // a redundant confirmation. Implementing it later requires mapping the
    // refund entity's payment_id → order_id to match transactions.external_ref.
    if (!kind) return null;

    const entity = (parsed as { payload?: { payment?: { entity?: { order_id?: unknown } } } })
      .payload?.payment?.entity;
    const orderId = entity?.order_id;
    if (typeof orderId !== 'string' || orderId.length === 0) return null;

    return { kind, gatewayRef: orderId };
  }
}
