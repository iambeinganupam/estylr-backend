import { TX_METHOD } from '../../../lib/constants';
import type { PaymentMethodHandler, PaymentMethodValidationContext } from './payment-method.types';

/**
 * Gateway-routed "any" method — the customer is bounced to the payment
 * provider's hosted page (Razorpay / Stripe Checkout) and picks the
 * underlying instrument there. Keeps the portal's confirm step simple
 * when we don't want to pre-commit to a wire-type at booking.
 */
class OnlinePaymentMethod implements PaymentMethodHandler {
  readonly code = TX_METHOD.ONLINE;
  readonly label = 'Other online (net-banking, wallet, BNPL)';
  readonly description = 'Continue on our payment partner to pick your preferred method.';
  readonly requiresOnlineCapture = true;
  readonly iconKey = 'globe' as const;

  assertAllowed(_ctx: PaymentMethodValidationContext): void {
    // Gateway side handles all per-instrument limits.
  }
}

export const onlinePaymentMethod: PaymentMethodHandler = new OnlinePaymentMethod();
